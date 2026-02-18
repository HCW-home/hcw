import json
from pathlib import Path

from django.conf import settings

COMPONENT_PATHS = {
    "patient": Path(settings.BASE_DIR).parent / "patient" / "src" / "assets" / "i18n",
    "practitioner": Path(settings.BASE_DIR).parent / "practitioner" / "public" / "i18n",
}


def get_json_path(component, lang):
    return COMPONENT_PATHS[component] / f"{lang}.json"


def get_available_languages(component):
    i18n_dir = COMPONENT_PATHS.get(component)
    if not i18n_dir or not i18n_dir.is_dir():
        return []
    return sorted(p.stem for p in i18n_dir.glob("*.json"))


def flatten_dict(d, parent_key=""):
    items = {}
    for k, v in d.items():
        new_key = f"{parent_key}.{k}" if parent_key else k
        if isinstance(v, dict):
            items.update(flatten_dict(v, new_key))
        else:
            items[new_key] = str(v) if v is not None else ""
    return items


def load_translations(component, lang):
    path = get_json_path(component, lang)
    if not path.is_file():
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return dict(sorted(flatten_dict(data).items()))
