"""Apply dashboard owner aliases; never rewrite original campaign/object text."""
import argparse
import json
from collections import Counter
from pathlib import Path

OWNER_ALIASES = {'贺羽琼': '刘芳芳'}
OWNER_FIELDS = {'运营组长', '品类负责人', '负责人'}


def normalize_owner_names(payload):
    changes = Counter()

    def walk(value, path=()):
        if isinstance(value, dict):
            return {key: walk(item, path + (key,)) for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item, path) for item in value]
        is_owner = path and (path[-1] in OWNER_FIELDS or (path[-1] == '维度' and 'summary_by_owner' in path))
        if is_owner and isinstance(value, str) and value in OWNER_ALIASES:
            changes['/'.join(path)] += 1
            return OWNER_ALIASES[value]
        return value

    return walk(payload), dict(changes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding='utf-8'))
    normalized, changes = normalize_owner_names(payload)
    Path(args.output).write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'changed_values': sum(changes.values()), 'paths': changes}, ensure_ascii=False, indent=2))
