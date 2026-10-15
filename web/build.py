from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
original = (root / 'web/original.html').read_text()
svgs = re.findall(r'<svg\b.*?</svg>', original, re.S)
assert len(svgs) == 2
html = (root / 'web/template.html').read_text()
for marker, value in [
    ('/*STYLES*/', (root / 'web/style.css').read_text()),
    ('<!--SENSOR_SVG-->', svgs[0]),
    ('<!--HEAT_SVG-->', svgs[1]),
    ('/*DECODER*/', (root / 'insole-decoder.js').read_text().replace('</script', '<\\/script')),
    ('/*APP*/', (root / 'web/app.js').read_text().replace('</script', '<\\/script')),
]:
    html = html.replace(marker, value)
assert re.findall(r'<svg\b.*?</svg>', html, re.S) == svgs
(root / 'Nova-Insole-Lab.html').write_text(html)
print('Built standalone HTML. Original SVG blocks preserved exactly.')
