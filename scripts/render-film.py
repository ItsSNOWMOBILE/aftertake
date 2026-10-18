"""Aftertake's CPU film renderer: cuts, dissolves, stills, typography and voiceover."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from fractions import Fraction
import av
import imageio_ffmpeg
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

KINETIC = {'build', 'typewriter', 'impact', 'wipe', 'spoken'}


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
    size = round(title.get('fontSize',{'headline':72,'caption':48,'kicker':28}[title['style']]) * scale)
    font = ImageFont.truetype(str(Path(fonts) / ('manrope.ttf' if title['style'] == 'headline' else 'dm-sans.ttf')), size)
    if title['style'] == 'headline':
        font.set_variation_by_axes([700])
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
    box = draw.multiline_textbbox((0, 0), text, font=font, spacing=round(size * .22), align='center')
    text_height = box[3] - box[1]
    y = {'top': height * .12, 'center': (height - text_height) / 2, 'bottom': height * .86 - text_height}[title['position']]
    x = (width - (box[2] - box[0])) / 2
    pad = round(16 * scale)
    if title['style'] == 'caption':
        draw.rounded_rectangle((max(0, x-pad), y-pad, min(width, width-x+pad), y+text_height+pad), radius=round(8*scale), fill=(12, 18, 11, 205))
    draw.multiline_text((x, y-box[1]), text, font=font, spacing=round(size*.22), align='center', fill=title['color'],
        stroke_width=max(1, round(2 * scale)) if title['style'] != 'caption' else 0, stroke_fill=(8, 12, 9, 190))
    if not layout:
        return image
    glyphs = Image.new('RGBA', (width, height))
    glyph_draw = ImageDraw.Draw(glyphs)
    stroke = max(1, round(2*scale)) if title['style'] != 'caption' else 0
    origin_y = y-box[1]
    glyph_draw.multiline_text((x,origin_y),text,font=font,spacing=round(size*.22),align='center',fill=title['color'],
        stroke_width=stroke,stroke_fill=(8,12,9,190))
    background = Image.new('RGBA',(width,height))
    if title['style'] == 'caption':
        ImageDraw.Draw(background).rounded_rectangle((max(0,x-pad),y-pad,min(width,width-x+pad),y+text_height+pad),radius=round(8*scale),fill=(12,18,11,205))
    # Derive line advance from the same layout engine used for the final image.
    spacing=round(size*.22)
    advance=glyph_draw.multiline_textbbox((0,0),'A\nA',font=font,spacing=spacing)[3]-glyph_draw.textbbox((0,0),'A',font=font)[3]
    words=[];character_index=0
    for line_index,line in enumerate(lines):
        line_x=(width-glyph_draw.textlength(line,font=font))/2
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
    return {'image':image,'glyphs':glyphs,'background':background,'words':words,'font':font,'size':size,'characters':len(text)}


def speech_layout(title,width,height,fonts):
    phrases={}
    for word in title['words']:
        phrases.setdefault(word['phrase'],[]).append(word)
    return {'image':Image.new('RGBA',(width,height)),'phrases':{
        number:{'timings':words,'layout':title_image({**title,'text':' '.join(word['text']for word in words),'color':'#ffffff'},width,height,fonts,layout=True)}
        for number,words in phrases.items()}}


def title_motion_frame(title, layout, elapsed):
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
        selected=layout['phrases'][phrase];part=selected['layout'];result=part['image'].copy();draw=ImageDraw.Draw(result)
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
            process.stdin.write(title_motion_frame(title,layout,frame/24-title['start']).tobytes())
        process.stdin.close();process.stdin=None
        _,error=process.communicate(timeout=120)
        if process.returncode:
            raise RuntimeError(error.decode('utf-8',errors='replace')[-3000:])
    except BaseException:
        process.kill();process.wait();raise


def join_picture(segments, output, width, height):
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
                    if i<overlap:encode(Image.blend(held[i],picture,i/overlap))
                    elif i<count-following:encode(picture)
                    else:next_held.append(picture)
            if decoded!=count:raise ValueError('A film cut did not contain its requested frames.')
            held=next_held
        if held or written!=sum(round(row[1]*24)-row[2] for row in segments):raise ValueError('Film join timing changed.')
        for packet in stream.encode():container.mux(packet)


def assemble(settings):
    output = Path(settings['output'])
    width, height = settings['width'], settings['height']
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
        for title_index, title in enumerate(settings.get('titles', [])):
            animated=title['animation'] in KINETIC
            image = folder / f'title-{title_index}{".mov" if animated else ".png"}'
            if animated:
                animate_title(title,width,height,settings['fonts'],image,binary)
            else:
                title_image(title, width, height, settings['fonts']).save(image)
            title_files.append((title, image))
        total_frames = 0
        previous_count = 0
        segments = []
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
            if framing:
                zoom, end_zoom, x, y = (framing[key] for key in ['zoom', 'endZoom', 'x', 'y'])
                if not (1 <= zoom <= 3 and 1 <= end_zoom <= 3 and 0 <= x <= 1 and 0 <= y <= 1):
                    raise ValueError('A shot needs bounded framing settings.')
                # zoompan rounds its crop rectangle to whole input pixels,
                # making slow moves jump. Perspective maps a fractional crop
                # to the output corners, keeping both scale and anchor smooth.
                # Work in 4:4:4 so chroma does not snap to two-pixel boundaries.
                # perspective's output counter starts at one.
                z = f'({zoom}+({end_zoom}-{zoom})*(on-1)/{max(1,count-1)})'
                left, top = f'(W-W/{z})*{x}', f'(H-H/{z})*{y}'
                right, bottom = f'{left}+W/{z}', f'{top}+H/{z}'
                zoom_filter = f",format=yuv444p,perspective=x0='{left}':y0='{top}':x1='{right}':y1='{top}':x2='{left}':y2='{bottom}':x3='{right}':y3='{bottom}':sense=source:eval=frame:interpolation=cubic"
            filters = [f'[0:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,'
                f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x141815,setsar=1,tpad=stop_mode=clone:stop_duration=1,fps=24,'
                f'trim=end_frame={count},setpts=N/(24*TB){zoom_filter}[picture]']
            # Render only the layers intersecting this cut. Delaying every
            # full-film PNG input inside one global framesync graph can stall
            # FFmpeg before its first output packet. Local cut clocks also
            # bound memory and retain fades for titles that cross a cut.
            previous = '[picture]'
            local_index = 0
            for title, image in title_files:
                window = title_window(title,total_frames-count,count)
                if window is None:
                    continue
                local_index += 1
                length = title['end'] - title['start']
                first, last, source_first, source_last = window
                layer_first, _, active_end = title_frames(title)
                phase=max(0,title['start']-layer_first/24)
                args += ['-threads','1','-i',str(image)] if title['animation'] in KINETIC else ['-loop','1','-framerate','24','-t',f'{(active_end-layer_first)/24:.9f}','-threads','1','-i',str(image)]
                fade = min(.25, length/3)
                chain = f'[{local_index}:v:0]format=rgba'
                if title.get('animation') != 'none' and title['animation'] not in KINETIC:
                    chain += f',fade=t=in:st={phase:.9f}:d={fade:.9f}:alpha=1,fade=t=out:st={phase+length-fade:.9f}:d={fade:.9f}:alpha=1'
                chain += f',trim=start_frame={source_first}:end_frame={source_last},setpts=N/(24*TB)+{first}/(24*TB)[layer{local_index}]'
                filters.append(chain)
                y = f"'-18*(1-min(1,max(0,(t-({title['start']-cut_start:.9f}))/.35)))'" if title.get('animation') == 'rise' else '0'
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
            run([*args, '-filter_complex_threads', '2', '-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-r', '24',
                '-fps_mode', 'cfr', '-c:a', 'pcm_s16le', '-t', str(duration), str(segment)])
            segments.append((segment, duration, overlap, cut_start))
        # Explicit cut durations keep every join on the 24 fps timeline.
        base = folder / 'cuts.mov'
        if any(row[2] for row in segments):
            picture=folder/'picture.mov'
            join_picture(segments,picture,width,height)
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
            delay = round(audio['start'] * 48000)
            audio_filters.append(f"[{index+1}:a:0]atrim=start={audio['sourceStart']}:end={audio['sourceEnd']},"
                f"asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={audio['volume']},adelay={delay}S:all=1[voice{index}]")
            audio_links.append(f'[voice{index}]')
        audio_filters.append(''.join(audio_links) + f'amix=inputs={len(audio_links)}:duration=first:normalize=0,alimiter=limit=0.95:level=0,atrim=duration={duration},asetpts=N/SR/TB[audio]')
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
