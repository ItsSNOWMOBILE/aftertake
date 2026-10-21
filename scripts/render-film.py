"""Aftertake's CPU film renderer: cuts, dissolves, stills, typography and voiceover."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import importlib.util
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
import av
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

_motion_spec = importlib.util.spec_from_file_location('aftertake_film_motion', Path(__file__).with_name('film_motion.py'))
film_motion = importlib.util.module_from_spec(_motion_spec)
_motion_spec.loader.exec_module(film_motion)
_scene_spec = importlib.util.spec_from_file_location('aftertake_film_scene', Path(__file__).with_name('film_scene.py'))
film_scene = importlib.util.module_from_spec(_scene_spec)
_scene_spec.loader.exec_module(film_scene)

KINETIC = {'build', 'typewriter', 'impact', 'wipe', 'spoken', 'slam', 'pop', 'reveal', 'glitch', 'scramble'}
# Titles and cuts render independently, so they share the CPU. Pillow and the
# FFmpeg pipes release the interpreter lock, and every layer is encoded
# losslessly, so the output is identical to a one-at-a-time render.
WORKERS = max(1, min(int(os.environ.get('AFTERTAKE_FILM_WORKERS') or 0) or os.cpu_count() or 1, 8))
# These animate the finished title image, which already carries any tilt.
WHOLE_IMAGE = {'impact', 'wipe', 'slam', 'glitch'}
FONT_FILES = {'display': 'archivo-black.ttf', 'condensed': 'anton.ttf', 'mono': 'jetbrains-mono.ttf'}
BOXES = {'stamp', 'highlight', 'underline'}
SCRAMBLE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?'


def clamp(value):
    return max(0, min(1, value))


def motion_hash(value):
    """The browser preview's Math.imul hash, so glitch and scramble noise match."""
    return ((int(value) * 2654435761) & 0xffffffff) / 4294967296


def title_frame(elapsed):
    return math.floor(elapsed * 24 + 1e-6)


def slam_motion(elapsed, duration):
    land = clamp(elapsed / (duration * .4))
    after = elapsed - duration * .4
    amplitude = .018 * math.exp(-9 * after) if after > 0 else 0
    return {'scale': 1 + 1.6 * (1 - land * land), 'x': amplitude * math.sin(2 * math.pi * 13 * after),
        'y': amplitude * .6 * math.cos(2 * math.pi * 17 * after), 'opacity': clamp(elapsed / (duration * .12))}


def stagger(index, count, duration, spread):
    return duration * spread * index / (count - 1) if count > 1 else 0


def pop_word(index, count, elapsed, duration):
    part = clamp((elapsed - stagger(index, count, duration, .6)) / (duration * (.4 if count > 1 else 1)))
    return {'scale': 1 + 2.70158 * (part - 1) ** 3 + 1.70158 * (part - 1) ** 2 if part else 0, 'opacity': clamp(part * 4)}


def reveal_word(index, count, elapsed, duration):
    part = clamp((elapsed - stagger(index, count, duration, .5)) / (duration * (.5 if count > 1 else 1)))
    return {'visible': part > 0, 'offset': (1 - part) ** 3}


def glitch_motion(elapsed, duration):
    frame = title_frame(elapsed)
    amount = (1 - max(0, elapsed) / duration) ** 2 if elapsed < duration else 0
    return {'amount': amount, 'split': amount * .02 * (-1 if motion_hash(frame * 7 + 1) < .5 else 1),
        'jitter': amount * .015 * (motion_hash(frame * 7 + 2) * 2 - 1), 'opacity': clamp(elapsed / .04)}


def scramble_characters(text, elapsed, duration, offset=0, total=None):
    """Characters of one word; offset counts the title's earlier visible characters."""
    frame = title_frame(elapsed)
    shown = []
    for index, character in enumerate(text):
        at = offset + index
        if elapsed < duration * .5 * at / total:
            shown.append(None)
        elif elapsed >= duration * (.35 + .65 * at / total):
            shown.append(character)
        else:
            shown.append(SCRAMBLE_GLYPHS[math.floor(motion_hash(frame * 31 + at) * len(SCRAMBLE_GLYPHS))])
    return shown


def paste_clipped(canvas, tile, left, top):
    """Alpha-composite a tile that may extend beyond the canvas edges."""
    left, top = round(left), round(top)
    crop = (max(0, -left), max(0, -top), min(tile.width, canvas.width - left), min(tile.height, canvas.height - top))
    if crop[0] < crop[2] and crop[1] < crop[3]:
        canvas.alpha_composite(tile.crop(crop), (left + crop[0], top + crop[1]))


def tilt_picture(picture, title, center):
    angle = title.get('tilt', 0)
    if not angle:
        return picture
    # CSS rotates clockwise for positive angles; Pillow rotates counter-clockwise.
    return picture.rotate(-angle, resample=Image.Resampling.BICUBIC, center=center)


def title_font(title, size, fonts):
    family = title.get('font')
    if family is not None and family not in FONT_FILES:
        raise ValueError('Title font must be display, condensed or mono.')
    name = FONT_FILES[family] if family else ('manrope.ttf' if title['style'] == 'headline' else 'dm-sans.ttf')
    font = ImageFont.truetype(str(Path(fonts) / name), size)
    try:
        axes = font.get_variation_axes()
    except OSError:
        # Display and condensed faces have one fixed weight.
        return font
    weight = title.get('fontWeight', 700 if title['style'] == 'headline' else None)
    if weight is not None:
        # Preserve every other variable-font axis (DM Sans also has optical size).
        font.set_variation_by_axes([weight if axis['name'] == b'Weight' else axis['default'] for axis in axes])
    return font


def title_frames(title):
    # A computed cut boundary can be a few ulps below its integer frame. Keep
    # that rounding noise out of intersections and the animation's frame clock.
    return math.floor(title['start']*24+1e-7), math.ceil(title['start']*24-1e-7), math.ceil(title['end']*24-1e-7)


def title_window(title, cut_first, count):
    layer_first, active_first, active_end = title_frames(title)
    first, last = max(cut_first,active_first), min(cut_first+count,active_end)
    if first >= last:
        return None
    return first-cut_first, last-cut_first, first-layer_first, last-layer_first


def title_image(title, width, height, fonts, layout=False):
    scale = width / 1280
    align = title.get('align', 'center')
    weight = title.get('fontWeight')
    outlined = title.get('stroke', title['style'] != 'caption')
    if align not in ('left', 'center', 'right'):
        raise ValueError('Title alignment must be left, center or right.')
    if weight is not None and (type(weight) is not int or weight not in (400, 500, 600, 700)):
        raise ValueError('Title font weight must be 400, 500, 600 or 700.')
    if type(outlined) is not bool:
        raise ValueError('Title outline must be a boolean.')
    decoration = title.get('box')
    if decoration is not None and decoration not in BOXES:
        raise ValueError('Title box must be stamp, highlight or underline.')
    tilt = title.get('tilt', 0)
    if type(tilt) not in (int, float) or not math.isfinite(tilt) or not -20 <= tilt <= 20:
        raise ValueError('Title tilt must be between -20 and 20 degrees.')
    size = round(title.get('fontSize',{'headline':72,'caption':48,'kicker':28}[title['style']]) * scale)
    font = title_font(title, size, fonts)
    highlight = decoration == 'highlight'
    fill = '#0b0f0a' if highlight else title['color']
    stroke = max(1, round(2 * scale)) if outlined and not highlight else 0
    image = Image.new('RGBA', (width, height))
    draw = ImageDraw.Draw(image)
    lines = []
    for paragraph in title['text'].split('\n'):
        line = ''
        for word in paragraph.split():
            candidate = (line + ' ' + word).strip()
            if draw.textlength(candidate, font=font) > width * .82 and line:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    text = '\n'.join(lines)
    box = draw.multiline_textbbox((0, 0), text, font=font, spacing=round(size * .22), align=align)
    text_height = box[3] - box[1]
    text_width = box[2] - box[0]
    y = {'top': height * .12, 'center': (height - text_height) / 2, 'bottom': height * .86 - text_height}[title['position']]
    x = (width - text_width) / 2 if align == 'center' else width * .09 + (width * .82 - text_width) * (align == 'right')
    right = width - x if align == 'center' else x + text_width
    pad = round(16 * scale)
    center = (x + (box[0] + box[2]) / 2, y + text_height / 2)
    def decorate(target):
        # A box replaces the caption panel; it is drawn behind the glyphs.
        target_draw = ImageDraw.Draw(target)
        if decoration in ('stamp', 'highlight'):
            rect = (x+box[0]-size*.3, y-size*.18, x+box[2]+size*.3, y+text_height+size*.18)
            if highlight:
                target_draw.rectangle(rect, fill=title['color'])
            else:
                target_draw.rectangle(rect, outline=title['color'], width=max(2, round(size*.07)))
        elif decoration == 'underline':
            top = y + text_height + size * .12
            target_draw.rectangle((x+box[0], top, x+box[2], top+max(2, size*.09)), fill=title['color'])
        elif title['style'] == 'caption':
            target_draw.rounded_rectangle((max(0, x-pad), y-pad, min(width, right+pad), y+text_height+pad), radius=round(8*scale), fill=(12, 18, 11, 205))
    decorate(image)
    draw.multiline_text((x, y-box[1]), text, font=font, spacing=round(size*.22), align=align, fill=fill,
        stroke_width=stroke, stroke_fill=(8, 12, 9, 190))
    if not layout:
        return tilt_picture(image, title, center)
    glyphs = Image.new('RGBA', (width, height))
    glyph_draw = ImageDraw.Draw(glyphs)
    origin_y = y-box[1]
    glyph_draw.multiline_text((x,origin_y),text,font=font,spacing=round(size*.22),align=align,fill=fill,
        stroke_width=stroke,stroke_fill=(8,12,9,190))
    background = Image.new('RGBA',(width,height))
    decorate(background)
    # Derive line advance from the same layout engine used for the final image.
    spacing=round(size*.22)
    advance=glyph_draw.multiline_textbbox((0,0),'A\nA',font=font,spacing=spacing)[3]-glyph_draw.textbbox((0,0),'A',font=font)[3]
    words=[];character_index=0
    for line_index,line in enumerate(lines):
        line_width=glyph_draw.textlength(line,font=font)
        line_x=(width-line_width)/2 if align == 'center' else x+(text_width-line_width)*(align == 'right')
        prefix=''
        for word in line.split(' '):
            if not word:
                continue
            word_x=line_x+glyph_draw.textlength(prefix,font=font)
            word_y=origin_y+line_index*advance
            bounds=glyph_draw.textbbox((word_x,word_y),word,font=font,stroke_width=stroke)
            rect=(math.floor(bounds[0])-2,math.floor(bounds[1])-2,math.ceil(bounds[2])+2,math.ceil(bounds[3])+2)
            words.append({'text':word,'index':character_index+len(prefix),'x':word_x,'y':word_y,'rect':rect})
            prefix+=word+' '
        character_index+=len(line)+1
    return {'image':tilt_picture(image,title,center),'glyphs':glyphs,'background':background,'words':words,'font':font,
        'size':size,'characters':len(text),'center':center,'fill':fill,'stroke':stroke}


def speech_layout(title,width,height,fonts):
    phrases={}
    for word in title['words']:
        phrases.setdefault(word['phrase'],[]).append(word)
    return {'image':Image.new('RGBA',(width,height)),'phrases':{
        number:{'timings':words,'layout':title_image({**title,'text':' '.join(word['text']for word in words),'color':'#ffffff'},width,height,fonts,layout=True)}
        for number,words in phrases.items()}}


def title_motion_frame(title, layout, elapsed):
    picture = kinetic_frame(title, layout, elapsed)
    if elapsed < 0 or title['animation'] in WHOLE_IMAGE:
        return picture
    if title['animation'] == 'spoken':
        phrase = 0
        for word in title['words']:
            if elapsed >= word['start']:
                phrase = word['phrase']
        return tilt_picture(picture, title, layout['phrases'][phrase]['layout']['center'])
    return tilt_picture(picture, title, layout['center'])


def kinetic_frame(title, layout, elapsed):
    if elapsed < 0:
        return Image.new('RGBA',layout['image'].size)
    length=title['end']-title['start']
    duration=min(title.get('motionDuration',.8),length*.8)
    clamp=lambda value:max(0,min(1,value))
    progress=clamp(elapsed/duration)
    fade=min(.25,length/3)
    exit_opacity=clamp((length-elapsed)/fade)
    image=layout['image'];width,height=image.size
    def opacity(picture,amount):
        result=picture.copy();result.putalpha(result.getchannel('A').point([round(i*amount) for i in range(256)]));return result
    if title['animation']=='spoken':
        phrase=0
        for word in title['words']:
            if elapsed>=word['start']:phrase=word['phrase']
        selected=layout['phrases'][phrase];part=selected['layout']
        # Start from the untilted pieces; title_motion_frame applies any tilt once.
        result=part['background'].copy();result.alpha_composite(part['glyphs']);draw=ImageDraw.Draw(result)
        for word,position in zip(selected['timings'],part['words']):
            if word['start']<=elapsed<word['end']:
                left,top,right,bottom=position['rect'];pad=round(part['size']*.08)
                draw.rounded_rectangle((left-pad,top-pad,right+pad,bottom+pad),radius=max(1,pad),fill=title['color'])
                draw.text((position['x'],position['y']),position['text'],font=part['font'],fill='#17210f')
        return opacity(result,min(clamp(elapsed/.08),clamp((length-elapsed)/.08)))
    if title['animation']=='impact':
        back=1+2.70158*(progress-1)**3+1.70158*(progress-1)**2
        zoom=1+.16*(1-back)
        box=image.getbbox();cx=(box[0]+box[2])/2;cy=(box[1]+box[3])/2
        result=image.transform((width,height),Image.Transform.AFFINE,(1/zoom,0,cx*(1-1/zoom),0,1/zoom,cy*(1-1/zoom)),Image.Resampling.BICUBIC)
        return opacity(result,exit_opacity*clamp(elapsed/min(.12,duration)))
    if title['animation']=='slam':
        motion=slam_motion(elapsed,duration);box=image.getbbox()
        if not box:
            return image
        zoom=motion['scale'];cx=(box[0]+box[2])/2;cy=(box[1]+box[3])/2
        dx=motion['x']*width;dy=motion['y']*width
        result=image.transform((width,height),Image.Transform.AFFINE,(1/zoom,0,cx-(cx+dx)/zoom,0,1/zoom,cy-(cy+dy)/zoom),Image.Resampling.BICUBIC)
        return opacity(result,exit_opacity*motion['opacity'])
    if title['animation']=='glitch':
        motion=glitch_motion(elapsed,duration);result=image
        if motion['amount']>0:
            split=round(motion['split']*width);jitter=round(motion['jitter']*width)
            result=Image.new('RGBA',(width,height))
            alpha=image.getchannel('A')
            # Match the preview's red and cyan text shadows beneath the title.
            for colour,offset in (((255,42,85),jitter-split),((34,227,255),jitter+split)):
                ghost=Image.new('RGBA',(width,height),colour+(0,));ghost.putalpha(alpha)
                paste_clipped(result,ghost,offset,0)
            paste_clipped(result,image,jitter,0)
            box=image.getbbox()
            if box and motion['amount']>.05:
                frame=title_frame(elapsed);span=box[3]-box[1]
                for band in range(3):
                    top=box[1]+round(span*motion_hash(frame*13+band*2))
                    bottom=min(height,top+max(1,round(span*(.06+.1*motion_hash(frame*13+band*2+1)))))
                    shift=round((motion_hash(frame*17+band)*2-1)*motion['amount']*.04*width)
                    strip=result.crop((0,top,width,bottom))
                    result.paste(Image.new('RGBA',strip.size),(0,top))
                    paste_clipped(result,strip,shift,top)
        return opacity(result,exit_opacity*motion['opacity'])
    if title['animation']=='wipe':
        box=image.getbbox();edge=box[0]+(box[2]-box[0])*(1-(1-progress)**3)
        mask=Image.new('L',(width,height));ImageDraw.Draw(mask).rectangle((0,0,max(0,edge),height),fill=255)
        result=image.copy();result.putalpha(ImageChops.multiply(result.getchannel('A'),mask));return opacity(result,exit_opacity)
    result=opacity(layout['background'],min(1,elapsed/.15)*exit_opacity)
    if title['animation']=='typewriter':
        visible=math.floor(layout['characters']*progress)
        mask=Image.new('L',(width,height));draw=ImageDraw.Draw(mask);caret=None
        for word in layout['words']:
            count=max(0,min(len(word['text']),visible-word['index']))
            if count:
                end=word['x']+ImageDraw.Draw(layout['glyphs']).textlength(word['text'][:count],font=layout['font'])
                left,top,right,bottom=word['rect'];draw.rectangle((left,top,min(right,end+2),bottom),fill=255)
                caret=(end,top,bottom)
        letters=layout['glyphs'].copy();letters.putalpha(ImageChops.multiply(letters.getchannel('A'),mask));result.alpha_composite(opacity(letters,exit_opacity))
        if caret and progress<1 and math.floor(max(0,elapsed)*4)%2==0:
            ImageDraw.Draw(result).rectangle((caret[0]+3,caret[1]+2,caret[0]+max(4,layout['size']*.035),caret[2]-2),fill=title['color'])
        return result
    count=len(layout['words'])
    if title['animation']=='scramble':
        letters=Image.new('RGBA',(width,height));draw=ImageDraw.Draw(letters);font=layout['font']
        total=max(1,sum(len(word['text']) for word in layout['words']));seen=0
        for word in layout['words']:
            shown=scramble_characters(word['text'],elapsed,duration,seen,total);seen+=len(word['text'])
            for index,character in enumerate(shown):
                if character is None:
                    continue
                # Keep each glyph at its settled position so the line never reflows.
                left=word['x']+draw.textlength(word['text'][:index],font=font)
                draw.text((left,word['y']),character,font=font,fill=layout['fill'],stroke_width=layout['stroke'],stroke_fill=(8,12,9,190))
        result.alpha_composite(opacity(letters,exit_opacity));return result
    if title['animation'] in ('pop','reveal'):
        for index,word in enumerate(layout['words']):
            left,top,right,bottom=word['rect'];tile=layout['glyphs'].crop(word['rect'])
            if title['animation']=='pop':
                part=pop_word(index,count,elapsed,duration)
                if part['scale']<=0:
                    continue
                size=(max(1,round(tile.width*part['scale'])),max(1,round(tile.height*part['scale'])))
                paste_clipped(result,opacity(tile.resize(size,Image.Resampling.BICUBIC),part['opacity']*exit_opacity),
                    (left+right)/2-size[0]/2,(top+bottom)/2-size[1]/2)
            else:
                part=reveal_word(index,count,elapsed,duration)
                if not part['visible']:
                    continue
                shift=round(part['offset']*1.1*tile.height)
                if shift>=tile.height:
                    continue
                moved=Image.new('RGBA',tile.size);moved.paste(tile.crop((0,0,tile.width,tile.height-shift)),(0,shift))
                result.alpha_composite(opacity(moved,exit_opacity),(left,top))
        return result
    for index,word in enumerate(layout['words']):
        delay=duration*.65*index/(count-1) if count>1 else 0
        part=clamp((elapsed-delay)/(duration*(.35 if count>1 else 1)))
        ease=1-(1-part)**3
        if not ease:
            continue
        left,top,right,bottom=word['rect'];tile=layout['glyphs'].crop(word['rect'])
        dy=(1-ease)*layout['size']*.4
        moved=tile.transform((tile.width,tile.height+math.ceil(layout['size']*.4)+2),Image.Transform.AFFINE,(1,0,0,0,1,-dy),Image.Resampling.BICUBIC)
        result.alpha_composite(opacity(moved,ease*exit_opacity),(left,top))
    return result


def animate_title(title, width, height, fonts, output, binary):
    layout=speech_layout(title,width,height,fonts) if title['animation']=='spoken' else title_image(title,width,height,fonts,layout=True)
    process=subprocess.Popen([binary,'-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{width}x{height}','-r','24','-i','pipe:0',
        '-an','-c:v','qtrle','-pix_fmt','argb','-threads','2',str(output)],stdin=subprocess.PIPE,stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    try:
        layer_first, _, active_end = title_frames(title)
        for frame in range(layer_first,active_end):
            elapsed = frame/24-title['start']
            if 'motion' not in title:
                picture = title_motion_frame(title,layout,elapsed)
            else:
                if title['animation'] in KINETIC:
                    picture = title_motion_frame(title,layout,elapsed)
                else:
                    picture = layout['image']
                    if title['animation'] != 'none':
                        length = title['end']-title['start']
                        fade = min(.25,length/3)
                        amount = max(0,min(1,elapsed/fade))*max(0,min(1,(length-elapsed)/fade))
                        picture = film_motion.opacity(picture,amount)
                    if title['animation'] == 'rise':
                        pose = {**film_motion.IDENTITY,'y':-18/height*(1-max(0,min(1,elapsed/.35)))}
                        picture = film_motion.transform_title(picture,pose)
                pose = film_motion.motion_at(title['motion'],film_motion.motion_progress(title['start'],title['end'],frame))
                picture = film_motion.transform_title(picture,pose)
            process.stdin.write(picture.tobytes())
        process.stdin.close();process.stdin=None
        _,error=process.communicate(timeout=120)
        if process.returncode:
            raise RuntimeError(error.decode('utf-8',errors='replace')[-3000:])
    except BaseException:
        process.kill();process.wait();raise


def animate_graphic(graphic, width, height, output, binary):
    layout = film_motion.graphic_layout(graphic,width,height)
    process = subprocess.Popen([binary,'-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',f'{width}x{height}','-r','24','-i','pipe:0',
        '-an','-c:v','qtrle','-pix_fmt','argb','-threads','2',str(output)],stdin=subprocess.PIPE,stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    try:
        layer_first, _, active_end = title_frames(graphic)
        for frame in range(layer_first,active_end):
            process.stdin.write(film_motion.graphic_frame(layout,frame).tobytes())
        process.stdin.close();process.stdin=None
        _,error=process.communicate(timeout=120)
        if process.returncode:
            raise RuntimeError(error.decode('utf-8',errors='replace')[-3000:])
    except BaseException:
        process.kill();process.wait();raise


def scene_renderer(scene, graphics, titles, width, height, fonts):
    # A bounded LRU avoids retaining three full-canvas title bitmaps for every
    # title or every spoken phrase. At 4K a single layout can approach 100 MiB.
    cache = OrderedDict()
    cache_bytes = 0
    def image_bytes(value):
        if isinstance(value, Image.Image):
            return value.width * value.height * len(value.getbands())
        if isinstance(value, dict):
            return sum(image_bytes(item) for item in value.values())
        return 0
    def render_child(kind, layer, frame):
        nonlocal cache_bytes
        elapsed = frame / 24 - layer['start']
        phrase = 0
        if kind == 'title' and layer['animation'] == 'spoken':
            for word in layer['words']:
                if elapsed >= word['start']:
                    phrase = word['phrase']
        key = kind, layer['id'], phrase
        if key not in cache:
            if kind == 'graphic':
                layout = film_motion.graphic_layout(layer, width, height)
            elif layer['animation'] == 'spoken':
                words = [word for word in layer['words'] if word['phrase'] == phrase]
                layout = {'image': Image.new('RGBA', (width, height)), 'phrases': {phrase: {
                    'timings': words, 'layout': title_image({**layer, 'text': ' '.join(word['text'] for word in words),
                        'color': '#ffffff'}, width, height, fonts, layout=True)}}}
            else:
                layout = title_image(layer, width, height, fonts, layout=layer['animation'] in KINETIC)
            size = image_bytes(layout)
            while cache and (len(cache) >= 8 or cache_bytes + size > 128 * 1024 * 1024):
                _, (_, removed) = cache.popitem(last=False)
                cache_bytes -= removed
            cache[key] = layout, size
            cache_bytes += size
        cache.move_to_end(key)
        layout = cache[key][0]
        if kind == 'graphic':
            return film_scene.graphic_sample(layout, frame, film_motion)
        if layer['animation'] in KINETIC:
            picture = title_motion_frame(layer, layout, elapsed)
        else:
            picture = layout
            if layer['animation'] != 'none':
                length = layer['end'] - layer['start']
                fade = min(.25, length / 3)
                picture = film_motion.opacity(picture, max(0, min(1, elapsed / fade)) * max(0, min(1, (length - elapsed) / fade)))
            if layer['animation'] == 'rise':
                picture = film_motion.transform_title(picture, {**film_motion.IDENTITY,
                    'y': -18 / height * (1 - max(0, min(1, elapsed / .35)))})
        if 'motion' in layer:
            picture = film_motion.transform_title(picture, film_motion.motion_at(layer['motion'], film_scene.phase(layer, frame)))
        return picture
    return film_scene.SceneRenderer(scene, graphics, titles, width, height, film_motion, render_child)


def animate_scene(scene, graphics, titles, width, height, fonts, count, output, binary):
    renderer = scene_renderer(scene, graphics, titles, width, height, fonts)
    process = subprocess.Popen([binary, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
        '-s', f'{width}x{height}', '-r', '24', '-i', 'pipe:0', '-an', '-c:v', 'qtrle', '-pix_fmt', 'argb',
        '-threads', '2', str(output)], stdin=subprocess.PIPE, stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    try:
        for frame in range(count):
            process.stdin.write(renderer.frame(frame).tobytes())
        process.stdin.close();process.stdin=None
        _, error = process.communicate(timeout=120)
        if process.returncode:
            raise RuntimeError(error.decode('utf-8', errors='replace')[-3000:])
    except BaseException:
        process.kill();process.wait();raise


def film_frame_count(shots):
    if not isinstance(shots, list) or not 1 <= len(shots) <= 48:
        raise ValueError('A scene film needs between one and 48 shots.')
    total = previous = 0
    for index, shot in enumerate(shots):
        for field in ('start', 'end'):
            film_motion.number(shot.get(field), 0, 600, 'shot ' + field)
        if shot['end'] < shot['start'] + .25:
            raise ValueError('A scene shot needs at least a quarter second.')
        dissolve = shot.get('dissolve', 0) or 0
        film_motion.number(dissolve, 0, 1, 'shot dissolve')
        count = round(shot['end'] * 24) - round(shot['start'] * 24)
        overlap = min(round(dissolve * 24), count // 2, previous // 2) if index else 0
        total += count - overlap
        previous = count
    if total > 600 * 24:
        raise ValueError('A scene film must stay within ten minutes.')
    return total


TRANSITIONS = {'dissolve', 'whip', 'zoom', 'flash', 'glitch', 'slide'}


def smooth(value):
    return value * value * (3 - 2 * value)


def smear(picture, amount):
    """Horizontal box blur about amount × width pixels wide, with clamped edges."""
    radius = round(amount * picture.width / 2)
    if radius < 1:
        return picture
    pixels = np.asarray(picture, dtype=np.float32)
    padded = np.pad(pixels, ((0, 0), (radius + 1, radius), (0, 0)), mode='edge')
    total = np.cumsum(padded, axis=1)
    blurred = (total[:, 2 * radius + 1:] - total[:, :-2 * radius - 1]) / (2 * radius + 1)
    return Image.fromarray(np.clip(blurred + .5, 0, 255).astype(np.uint8))


def scaled(picture, scale):
    """Centre crop-and-enlarge; the zoom punch never reveals an edge."""
    if scale <= 1:
        return picture
    width, height = picture.size
    crop_width, crop_height = width / scale, height / scale
    left, top = (width - crop_width) / 2, (height - crop_height) / 2
    return picture.resize(picture.size, Image.Resampling.BICUBIC, box=(left, top, left + crop_width, top + crop_height))


def transition_frame(kind, outgoing, incoming, progress):
    """One overlap frame; film-transitions.ts poses the browser preview with the same curves."""
    if kind in (None, 'dissolve'):
        return Image.blend(outgoing, incoming, progress)
    width, height = outgoing.size
    if kind in ('whip', 'slide'):
        travel = smooth(progress)
        canvas = Image.new('RGB', (width, height))
        if kind == 'whip':
            canvas.paste(outgoing, (round(-travel * width), 0))
            canvas.paste(incoming, (round((1 - travel) * width), 0))
            return smear(canvas, .06 * 4 * progress * (1 - progress))
        canvas.paste(outgoing, (0, round(-travel * height)))
        canvas.paste(incoming, (0, round((1 - travel) * height)))
        return canvas
    picture = incoming if progress >= .5 else outgoing
    if kind == 'zoom':
        scale = 1 + 1.5 * (2 * progress) ** 3 if progress < .5 else 1 + 1.5 * (1 - (2 * progress - 1)) ** 3
        # Three nearby scales approximate a radial zoom blur during the fast part.
        near = Image.blend(scaled(picture, scale), scaled(picture, scale * 1.03), .5)
        return Image.blend(near, scaled(picture, scale * 1.06), 1 / 3)
    if kind == 'flash':
        return Image.blend(picture, Image.new('RGB', (width, height), (255, 255, 255)), clamp((1 - abs(2 * progress - 1)) * 1.5))
    if kind == 'glitch':
        amount = 1 - abs(2 * progress - 1)
        frame = math.floor(progress * 24 * 8)
        shift = round(amount * .03 * width)
        red, green, blue = picture.split()
        result = Image.merge('RGB', (ImageChops.offset(red, shift, 0), green, ImageChops.offset(blue, -shift, 0)))
        result = ImageChops.offset(result, round(amount * .03 * width * (motion_hash(frame * 5 + 3) * 2 - 1)), 0)
        for band in range(5):
            top = round(height * motion_hash(frame * 11 + band))
            bottom = min(height, top + max(1, round(height * (.02 + .06 * motion_hash(frame * 11 + band + 5)))))
            strip = result.crop((0, top, width, bottom))
            result.paste(ImageChops.offset(strip, round((motion_hash(frame * 19 + band) * 2 - 1) * amount * .08 * width), 0), (0, top))
        return result
    raise ValueError('Choose a supported shot transition.')


def join_picture(segments, output, width, height, transitions=None):
    """Blend integer frame indices without an EOF-dependent framesync clock."""
    held=[];written=0
    with av.open(str(output),'w') as container:
        stream=container.add_stream('libx264',rate=24)
        stream.width=width;stream.height=height;stream.pix_fmt='yuv420p'
        stream.options={'crf':'18','preset':'fast','threads':'2'}
        def encode(picture):
            nonlocal written
            frame=av.VideoFrame.from_image(picture);frame.pts=written;frame.time_base=Fraction(1,24)
            for packet in stream.encode(frame):container.mux(packet)
            written+=1
        for index,(segment,duration,overlap,_) in enumerate(segments):
            count=round(duration*24)
            following=segments[index+1][2] if index+1<len(segments) else 0
            if len(held)!=overlap:raise ValueError('A dissolve lost its outgoing frame handles.')
            next_held=[];decoded=0
            with av.open(str(segment)) as source:
                for i,frame in enumerate(source.decode(video=0)):
                    picture=frame.to_image();decoded+=1
                    if i<overlap:encode(transition_frame((transitions or [None]*len(segments))[index],held[i],picture,i/overlap))
                    elif i<count-following:encode(picture)
                    else:next_held.append(picture)
            if decoded!=count:raise ValueError('A film cut did not contain its requested frames.')
            held=next_held
        if held or written!=sum(round(row[1]*24)-row[2] for row in segments):raise ValueError('Film join timing changed.')
        for packet in stream.encode():container.mux(packet)


def framing_canvas(width, height, zoom):
    """Retain crop detail within a bounded, aspect-exact CPU work canvas."""
    # Ordinary gentle pushes keep their original single-sample path and cost.
    # Strong crops need retained source detail before enlargement.
    if zoom <= 1.25:
        return width, height
    divisor = math.gcd(width, height)
    unit_width, unit_height = width // divisor, height // divisor
    # An even unit count keeps both dimensions codec-friendly without changing
    # their ratio; independently rounding dimensions would move the anchor.
    limit = min(4096 // unit_width, 4096 // unit_height,
        math.isqrt((4096 * 4096) // (unit_width * unit_height))) // 2 * 2
    if limit < divisor:
        raise ValueError('Framed film output exceeds the 4096-pixel CPU work canvas limit.')
    # Strong moves use a stable 3x lattice. A work canvas only a few pixels
    # larger than the output adds a second visible sampling beat on reduction.
    units = min(math.ceil(divisor * max(3, zoom) / 2) * 2, limit)
    return unit_width * units, unit_height * units


def camera_keyframes(framing):
    """Validate JSON camera data before constructing any FFmpeg expression."""
    if framing is None:
        return None
    if not isinstance(framing, dict):
        raise ValueError('Camera framing must be an object.')
    if 'fit' in framing and framing['fit'] not in ('contain', 'cover'):
        raise ValueError('Camera fit must be contain or cover.')
    if 'keyframes' not in framing:
        return None

    def number(value, low, high, name):
        if type(value) not in (int, float) or not low <= value <= high or not math.isfinite(value):
            raise ValueError(f'Camera {name} must be a finite number between {low} and {high}.')
        return float(value)

    # Retain the existing framing fields in portable projects, even though the
    # keyed camera supplies the effective position and scale for this shot.
    for name, low, high in [('zoom', 1, 3), ('endZoom', 1, 3), ('x', 0, 1), ('y', 0, 1)]:
        number(framing.get(name), low, high, name)
    values = framing['keyframes']
    if not isinstance(values, list) or not 2 <= len(values) <= 8:
        raise ValueError('Camera keyframes need between two and eight points.')
    keys = []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError('Each camera keyframe must be an object.')
        key = {name: number(value.get(name), low, high, name) for name, low, high in
               [('at', 0, 1), ('zoom', 1, 3), ('x', 0, 1), ('y', 0, 1)]}
        key['easing'] = value.get('easing', 'ease-in-out')
        if key['easing'] not in ('linear', 'ease-in-out', 'ease-out', 'hold'):
            raise ValueError('Choose a supported camera easing.')
        if keys and key['at'] <= keys[-1]['at']:
            raise ValueError('Camera keyframe times must increase strictly.')
        keys.append(key)
    if keys[0]['at'] != 0 or keys[-1]['at'] != 1:
        raise ValueError('Camera keyframes must start at zero and end at one.')
    return keys


def camera_expressions(keys, count):
    """Piecewise source-camera curves on the exact first-to-last frame clock."""
    progress = f'((on-1)/{max(1, count-1)})'

    def coordinate(name):
        expression = repr(keys[-1][name])
        for first, last in reversed(list(zip(keys, keys[1:]))):
            value = repr(first[name])
            if last['easing'] != 'hold':
                part = f'(({progress}-{first["at"]!r})/{(last["at"]-first["at"])!r})'
                if last['easing'] == 'ease-in-out':
                    eased = f'({part}*{part}*(3-2*{part}))'
                elif last['easing'] == 'ease-out':
                    eased = f'(1-pow(1-{part},3))'
                else:
                    eased = part
                value = f'({first[name]!r}+{(last[name]-first[name])!r}*{eased})'
            # The arriving key controls easing. A hold changes to its exact
            # destination at that key's time, including the shot's last frame.
            expression = f'if(lt({progress},{last["at"]!r}),{value},{expression})'
        return expression

    return tuple(coordinate(name) for name in ('zoom', 'x', 'y'))


def audio_fade_filters(audio):
    """Optional linear envelopes on the trimmed, normalized 48 kHz clock."""
    if 'fadeIn' not in audio and 'fadeOut' not in audio:
        return ''
    values = [audio.get(name, 0) for name in ('fadeIn', 'fadeOut')]
    if any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 10 for value in values):
        raise ValueError('Audio fades must be finite seconds between zero and ten.')
    start, end = audio['sourceStart'], audio['sourceEnd']
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in (start, end)):
        raise ValueError('Audio fades need a finite source trim.')
    duration = end - start
    if duration <= 0 or any(value > duration + 1e-9 for value in values):
        raise ValueError('Audio fades must each fit within the trimmed clip.')
    if not any(values):
        return ''
    # Keep the legacy chain byte-for-byte when fades are absent or zero. Active
    # envelopes use integer samples after resampling, independent of source PTS.
    filters = ['asetpts=N/SR/TB']
    count = round(duration * 48000)
    for kind, seconds in zip(('in', 'out'), values):
        if seconds:
            samples = max(1, round(seconds * 48000))
            first = 0 if kind == 'in' else max(0, count - samples)
            filters.append(f'afade=t={kind}:ss={first}:ns={samples}:curve=tri')
    return ','.join(filters) + ','


def audio_track_filter(audio, index):
    delay = round(audio['start'] * 48000)
    return (f"[{index+1}:a:0]atrim=start={audio['sourceStart']}:end={audio['sourceEnd']},"
        f"asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,{audio_fade_filters(audio)}"
        f"volume={audio['volume']},adelay={delay}S:all=1[voice{index}]")


def assemble(settings):
    output = Path(settings['output'])
    width, height = settings['width'], settings['height']
    keyed_cameras = [camera_keyframes(shot.get('framing')) for shot in settings['shots']]
    graphics = settings.get('graphics', [])
    if not isinstance(graphics, list) or len(graphics) > 24:
        raise ValueError('A film supports at most twenty-four graphics.')
    graphics = [film_motion.validate_graphic(graphic) for graphic in graphics]
    if len({graphic['id'] for graphic in graphics}) != len(graphics):
        raise ValueError('Every graphic needs a unique ID.')
    titles = [{**title,'motion':film_motion.validate_motion(title['motion'])} if 'motion' in title else title
              for title in settings.get('titles', [])]
    scene = settings.get('motionScene')
    if scene is not None:
        scene = film_scene.validate_scene(scene, graphics, titles, width, height, film_motion)
        scene_count = film_frame_count(settings['shots'])
        if any(group['end'] > scene_count / 24 + .001 for group in scene['groups']):
            raise ValueError('Motion groups must fit within the film timeline.')
    if graphics or any('motion' in title for title in titles) or scene is not None:
        film_motion.canvas_size(width,height)
    # Reject malformed standalone fade settings before encoding any footage.
    for audio in settings.get('audio', []):
        audio_fade_filters(audio)
    binary = imageio_ffmpeg.get_ffmpeg_exe()
    def run(arguments):
        try:
            return subprocess.run([binary, '-v', 'error', '-y', '-threads', '2', *arguments], check=True, capture_output=True,
                timeout=540, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except subprocess.CalledProcessError as error:
            raise RuntimeError(error.stderr.decode('utf-8', errors='replace')[-6000:]) from error
    with tempfile.TemporaryDirectory(prefix='aftertake-film-', dir=output.parent) as temporary:
        folder = Path(temporary)
        title_files = []
        if scene is not None:
            count = scene_count
            image = folder / 'scene.mov'
            animate_scene(scene, graphics, titles, width, height, settings['fonts'], count, image, binary)
            title_files.append(({'start': 0, 'end': count / 24, 'animation': 'none'}, image, True))
        layers = [('graphic', graphic, folder / f'graphic-{index}{".mov" if "motion" in graphic else ".png"}', 'motion' in graphic)
                  for index, graphic in enumerate(graphics if scene is None else [])]
        layers += [('title', title, folder / f'title-{index}{".mov" if title["animation"] in KINETIC or "motion" in title else ".png"}',
                    title['animation'] in KINETIC or 'motion' in title)
                   for index, title in enumerate(titles if scene is None else [])]
        def render_layer(layer):
            kind, item, image, animated = layer
            if kind == 'graphic' and animated:
                animate_graphic(item, width, height, image, binary)
            elif kind == 'graphic':
                film_motion.graphic_frame(film_motion.graphic_layout(item, width, height),
                                          math.ceil(item['start'] * 24 - 1e-7)).save(image)
            elif animated:
                animate_title(item, width, height, settings['fonts'], image, binary)
            else:
                title_image(item, width, height, settings['fonts']).save(image)
        with ThreadPoolExecutor(WORKERS) as pool:
            list(pool.map(render_layer, layers))
        title_files += [({**item, 'animation': 'none'} if kind == 'graphic' else item, image, animated)
                        for kind, item, image, animated in layers]
        total_frames = 0
        previous_count = 0
        segments = []
        encodes = []
        for index, shot in enumerate(settings['shots']):
            still = shot.get('kind') == 'image'
            audio = False
            if not still:
                with av.open(shot['source']) as container:
                    audio = bool(container.streams.audio)
                    video = container.streams.video[0]
                    available = float(video.duration * video.time_base) if video.duration else float(container.duration or 0) / av.time_base
                    if shot['end'] > available + 1 / 24:
                        raise ValueError('A film trim ends after its footage.')
            if shot['start'] < 0 or shot['end'] - shot['start'] < .25:
                raise ValueError('A film trim falls outside its footage.')
            count = round(shot['end']*24)-round(shot['start']*24)
            duration = count / 24
            dissolve = shot.get('dissolve', 0) or 0
            if not isinstance(dissolve, (int, float)) or not math.isfinite(dissolve) or not 0 <= dissolve <= 1:
                raise ValueError('A dissolve must be between zero and one second.')
            if shot.get('transition', 'dissolve') not in TRANSITIONS:
                raise ValueError('Choose a supported shot transition.')
            overlap = min(round(dissolve*24), count//2, previous_count//2) if index else 0
            total_frames -= overlap
            cut_start = total_frames / 24
            total_frames += count
            previous_count = count
            source = shot['source']
            if still:
                source = str(folder / f'still-{index}.png')
                with Image.open(shot['source']) as opened:
                    ImageOps.exif_transpose(opened).convert('RGB').save(source)
            args = ['-loop', '1', '-framerate', '24', '-i', source] if still else ['-ss', str(shot['start']), '-i', source]
            framing = shot.get('framing')
            zoom_filter = ''
            work_width, work_height = width, height
            if framing:
                zoom, end_zoom, x, y = (framing[key] for key in ['zoom', 'endZoom', 'x', 'y'])
                if not (1 <= zoom <= 3 and 1 <= end_zoom <= 3 and 0 <= x <= 1 and 0 <= y <= 1):
                    raise ValueError('A shot needs bounded framing settings.')
                keys = keyed_cameras[index]
                maximum_zoom = max(key['zoom'] for key in keys) if keys is not None else max(zoom, end_zoom)
                work_width, work_height = framing_canvas(width, height, maximum_zoom)
                # zoompan rounds its crop rectangle to whole input pixels,
                # making slow moves jump. Perspective maps a fractional crop
                # to the output corners, keeping both scale and anchor smooth.
                # Work in 4:4:4 so chroma does not snap to two-pixel boundaries.
                # perspective's output counter starts at one.
                if keys is None:
                    z = f'({zoom}+({end_zoom}-{zoom})*(on-1)/{max(1,count-1)})'
                    left, top = f'(W-W/{z})*{x}', f'(H-H/{z})*{y}'
                else:
                    z, anchor_x, anchor_y = camera_expressions(keys, count)
                    left, top = f'(W-W/({z}))*({anchor_x})', f'(H-H/({z}))*({anchor_y})'
                right, bottom = f'{left}+W/{z}', f'{top}+H/{z}'
                zoom_filter = f",format=yuv444p,perspective=x0='{left}':y0='{top}':x1='{right}':y1='{top}':x2='{left}':y2='{bottom}':x3='{right}':y3='{bottom}':sense=source:eval=frame:interpolation=cubic"
                if (work_width, work_height) != (width, height):
                    zoom_filter += f',scale={width}:{height}:flags=lanczos'
            if framing and framing.get('fit') == 'cover':
                source_fit = (f'scale={work_width}:{work_height}:force_original_aspect_ratio=increase:force_divisible_by=2,'
                    f'crop={work_width}:{work_height}:(iw-ow)/2:(ih-oh)/2')
            else:
                # Keep the legacy fit/pad path identical for absent or contain.
                source_fit = (f'scale={work_width}:{work_height}:force_original_aspect_ratio=decrease:force_divisible_by=2,'
                    f'pad={work_width}:{work_height}:(ow-iw)/2:(oh-ih)/2:color=0x141815')
            filters = [f'[0:v:0]{source_fit},setsar=1,tpad=stop_mode=clone:stop_duration=1,fps=24,'
                f'trim=end_frame={count},setpts=N/(24*TB){zoom_filter}[picture]']
            # Render only the layers intersecting this cut. Delaying every
            # full-film PNG input inside one global framesync graph can stall
            # FFmpeg before its first output packet. Local cut clocks also
            # bound memory and retain fades for titles that cross a cut.
            previous = '[picture]'
            local_index = 0
            for title, image, animated in title_files:
                window = title_window(title,total_frames-count,count)
                if window is None:
                    continue
                local_index += 1
                length = title['end'] - title['start']
                first, last, source_first, source_last = window
                layer_first, _, active_end = title_frames(title)
                phase=max(0,title['start']-layer_first/24)
                args += ['-threads','1','-i',str(image)] if animated else ['-loop','1','-framerate','24','-t',f'{(active_end-layer_first)/24:.9f}','-threads','1','-i',str(image)]
                fade = min(.25, length/3)
                chain = f'[{local_index}:v:0]format=rgba'
                if title.get('animation') != 'none' and title['animation'] not in KINETIC and 'motion' not in title:
                    chain += f',fade=t=in:st={phase:.9f}:d={fade:.9f}:alpha=1,fade=t=out:st={phase+length-fade:.9f}:d={fade:.9f}:alpha=1'
                chain += f',trim=start_frame={source_first}:end_frame={source_last},setpts=N/(24*TB)+{first}/(24*TB)[layer{local_index}]'
                filters.append(chain)
                y = f"'-18*(1-min(1,max(0,(t-({title['start']-cut_start:.9f}))/.35)))'" if title.get('animation') == 'rise' and 'motion' not in title else '0'
                filters.append(f"{previous}[layer{local_index}]overlay=x=0:y={y}:eof_action=pass:repeatlast=0:enable='gte(n,{first})*lt(n,{last})'[picture{local_index}]")
                previous = f'[picture{local_index}]'
            filters.append(f'{previous}null[v]')
            audio_input = '[0:a:0]aresample=48000,aformat=channel_layouts=stereo,apad' if audio else 'anullsrc=r=48000:cl=stereo'
            filters.append(f'{audio_input},atrim=duration={duration},asetpts=N/SR/TB[a]')
            # Intermediate AAC adds encoder priming and padding at every cut.
            # Concatenating those packets can break the mix clock and truncate
            # narration when loudnorm buffers its opening analysis window. PCM
            # keeps each cut sample-exact; encode AAC only in the final movie.
            segment = folder / f'shot-{index:03d}.mov'
            graph_arguments = ['-filter_complex', ';'.join(filters)]
            if keyed_cameras[index] is not None or graphics or any('motion' in title for title in titles) or scene is not None:
                # Eight independently eased points can exceed Windows' command
                # length after perspective expands all four corner expressions.
                graph_file = folder / f'camera-filters-{index:03d}.txt'
                graph_file.write_text(';'.join(filters), encoding='utf-8')
                graph_arguments = ['-filter_complex_script', str(graph_file)]
            encodes.append([*args, '-filter_complex_threads', '2', *graph_arguments, '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-r', '24',
                '-fps_mode', 'cfr', '-c:a', 'pcm_s16le', '-t', str(duration), str(segment)])
            segments.append((segment, duration, overlap, cut_start))
        # Each cut's encoder already uses two threads.
        with ThreadPoolExecutor(max(1, WORKERS // 2)) as pool:
            list(pool.map(run, encodes))
        # Explicit cut durations keep every join on the 24 fps timeline.
        base = folder / 'cuts.mov'
        if any(row[2] for row in segments):
            picture=folder/'picture.mov'
            join_picture(segments,picture,width,height,[shot.get('transition') for shot in settings['shots']])
            join_args, joins = [], []
            for index, (segment, _, _, _) in enumerate(segments):
                join_args += ['-threads','1','-i',str(segment)]
                joins.append(f'[{index}:a]asetpts=PTS-STARTPTS[a{index}]')
            sound = '[a0]'
            for index, (_, _, overlap, _) in enumerate(segments[1:], 1):
                if overlap:
                    joins.append(f'{sound}[a{index}]acrossfade=ns={overlap*2000}:c1=tri:c2=tri[joina{index}]')
                else:
                    joins.append(f'{sound}[a{index}]concat=n=2:v=0:a=1[joina{index}]')
                sound = f'[joina{index}]'
            source_sound=folder/'source.wav'
            run([*join_args,'-filter_complex_threads','2','-filter_complex',';'.join(joins),
                '-map',sound,'-c:a','pcm_s16le','-t',str(total_frames/24),str(source_sound)])
            run(['-i',str(picture),'-i',str(source_sound),'-map','0:v:0','-map','1:a:0','-c','copy',str(base)])
        else:
            (folder / 'cuts.txt').write_text(''.join(f"file '{segment.name}'\nduration {duration:.9f}\n" for segment, duration, _, _ in segments), encoding='utf-8')
            run(['-f', 'concat', '-safe', '0', '-i', str(folder / 'cuts.txt'), '-c', 'copy', str(base)])
        duration = total_frames / 24
        # Typography is already baked into its cut; this final pass only
        # encodes the stitched picture and independently mastered audio.
        arguments = ['-an', '-i', str(base)]
        # Master audio independently. Loudness analysis needs several seconds
        # of lookahead; combining it with many timed overlay inputs can stall
        # the video/audio demux queues before the first output frame.
        audio_arguments = ['-i', str(base)]
        audio_filters = [f"[0:a:0]aresample=48000,asetpts=N/SR/TB,volume={settings.get('sourceVolume', 1)}[sourceaudio]"]
        audio_links = ['[sourceaudio]']
        input_index = 1
        for index, audio in enumerate(settings.get('audio', [])):
            audio_arguments += ['-i', audio['source']]
            audio_filters.append(audio_track_filter(audio, index))
            audio_links.append(f'[voice{index}]')
        audio_filters.append(''.join(audio_links) + f'amix=inputs={len(audio_links)}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=duration={duration},asetpts=N/SR/TB[audio]')
        master = folder / 'mix.wav'
        run([*audio_arguments, '-filter_complex_threads', '2', '-filter_complex', ';'.join(audio_filters),
            '-map', '[audio]', '-c:a', 'pcm_s16le', '-t', str(duration), str(master)])
        if settings.get('normalizeAudio'):
            # Measure the complete mix, then apply one gain. Dynamic loudnorm
            # pumps when a mastered ad is followed by quieter raw narration.
            # Peak-limited constant gain preserves every line's envelope.
            analysis=run(['-v','info','-hide_banner','-nostats','-i',str(master),
                '-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'])
            report=analysis.stderr.decode('utf-8',errors='replace')
            measured=json.JSONDecoder().raw_decode(report[report.rfind('{'):])[0]
            loudness,peak=float(measured['input_i']),float(measured['input_tp'])
            if math.isfinite(loudness) and math.isfinite(peak):
                gain=min(-16-loudness,-1.5-peak)
                normalized=folder/'normalized.wav'
                run(['-i',str(master),'-af',f'volume={gain:.9f}dB','-c:a','pcm_s16le',str(normalized)])
                master=normalized
        arguments += ['-i', str(master)]
        metadata = json.dumps(settings['manifest'], separators=(',', ':'))
        for character in ['\\', '=', ';', '#', '\n']:
            metadata = metadata.replace(character, '\\' + character)
        (folder / 'manifest.txt').write_text(';FFMETADATA1\ncomment=' + metadata + '\n', encoding='utf-8')
        metadata_index = input_index + 1
        target = folder / 'film.mp4'
        run([*arguments, '-f', 'ffmetadata', '-i', str(folder / 'manifest.txt'), '-filter_complex_threads', '2',
            '-map', '0:v:0', '-map', f'{input_index}:a:0',
            '-c:v', 'libx264', '-threads', '2', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p',
            '-r', '24', '-fps_mode', 'cfr', '-c:a', 'aac', '-b:a', '192k', '-t', str(duration),
            '-map_metadata', str(metadata_index), '-movflags', '+faststart', str(target)])
        os.replace(target, output)


if __name__ == '__main__':
    assemble(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
