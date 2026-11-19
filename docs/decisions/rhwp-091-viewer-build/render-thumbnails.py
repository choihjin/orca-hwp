import re
import subprocess
import sys
from pathlib import Path

comparison = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
selection = {
    "nikl": (1, 20, 31),
    "health-center-table": (1,),
    "row-width": (1,),
}
for sample, pages in selection.items():
    directory = output / sample
    directory.mkdir(parents=True, exist_ok=True)
    previews = []
    for page in pages:
        for version in ("a", "b"):
            filename = f"p{page:03d}-{version}.svg"
            svg = (comparison / sample / filename).read_text()
            viewbox = re.search(r'\bviewBox="([^"]+)"', svg.split(">", 1)[0])
            x, y, width, height = map(float, viewbox[1].split())
            size = max(width, height)
            svg = svg.replace("<svg ", f'<svg x="{(size-width)/2}" y="{(size-height)/2}" ', 1)
            padded = (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
                f'viewBox="0 0 {size} {size}">\n'
                '<rect width="100%" height="100%" fill="white"/>\n'
                f'{svg}\n</svg>\n'
            )
            destination = directory / filename
            destination.write_text(padded)
            previews.append(destination)
    subprocess.run(["qlmanage", "-t", "-s", "900", "-o", str(directory), *map(str, previews)], check=True)
    for preview in previews:
        (directory / (preview.name + ".png")).stat()
