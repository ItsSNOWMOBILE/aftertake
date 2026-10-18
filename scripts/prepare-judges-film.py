"""Compatibility entry point for the current measured entry-film preparer."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('prepare-entry-film.py')), run_name='__main__')
