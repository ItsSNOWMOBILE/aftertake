"""Normalize local finished takes, then join picture and audio on the CPU."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import av
import imageio_ffmpeg


def assemble(settings):
    output = Path(settings['output'])
    width, height = settings['width'], settings['height']
    binary = imageio_ffmpeg.get_ffmpeg_exe()
    def run(arguments):
        subprocess.run([binary, '-v', 'error', '-y', *arguments], check=True, capture_output=True,
                       timeout=240, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    with tempfile.TemporaryDirectory(prefix='aftertake-film-', dir=output.parent) as temporary:
        folder = Path(temporary)
        arguments, filters, links, total_frames = [], [], [], 0
        for index, shot in enumerate(settings['shots']):
            with av.open(shot['source']) as container:
                audio = bool(container.streams.audio)
                video = container.streams.video[0]
                available = float(video.duration * video.time_base)
                if shot['end'] > available + 1 / 24 or shot['start'] < 0 or shot['end'] - shot['start'] < .25:
                    raise ValueError('A film trim falls outside its finished take.')
            # Round each cut to the output frame grid so picture and sound have
            # the same duration at every join, including mixed source rates.
            count = round((shot['end'] - shot['start']) * 24)
            duration = count / 24
            total_frames += count
            arguments += ['-ss', str(shot['start']), '-i', shot['source']]
            filters.append(f'[{index}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,'
                f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=1,'
                f'trim=end_frame={count},setpts=N/(24*TB)[v{index}]')
            audio_input = f'[{index}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad' if audio else 'anullsrc=r=48000:cl=stereo'
            filters.append(f'{audio_input},atrim=duration={duration},asetpts=N/SR/TB[a{index}]')
            links += [f'[v{index}]', f'[a{index}]']
        filters.append(''.join(links) + f'concat=n={len(settings["shots"])}:v=1:a=1[video][audio]')
        # Track-guided workflows can exceed Windows' 32K command-line limit.
        # FFmetadata escaping keeps the full portable manifest out of argv.
        metadata = json.dumps(settings['manifest'], separators=(',', ':'))
        for character in ['\\', '=', ';', '#', '\n']:
            metadata = metadata.replace(character, '\\' + character)
        (folder / 'manifest.txt').write_text(';FFMETADATA1\ncomment=' + metadata + '\n', encoding='utf-8')
        target = folder / 'film.mp4'
        run([*arguments, '-f', 'ffmetadata', '-i', str(folder / 'manifest.txt'), '-filter_complex', ';'.join(filters),
             '-map', '[video]', '-map', '[audio]', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p',
             '-r', '24', '-fps_mode', 'cfr', '-c:a', 'aac', '-b:a', '192k', '-t', str(total_frames / 24),
             '-map_metadata', str(len(settings['shots'])), '-movflags', '+faststart', str(target)])
        os.replace(target, output)


if __name__ == '__main__':
    assemble(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
