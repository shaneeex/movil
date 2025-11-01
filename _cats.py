import json, pathlib
path = pathlib.Path('projects.json')
projects = json.loads(path.read_text())
for p in projects:
    cat = p.get('category')
    print(p.get('title'), '->', cat)
