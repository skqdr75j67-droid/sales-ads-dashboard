"""Build immutable lazy-loading files without changing the canonical dashboard JSON."""
import argparse
import hashlib
import json
from pathlib import Path

DETAIL_FIELDS = ['月份', '触发日期', '品类', '运营组长', '规则类别', '规则大类', '广告活动', '标签', '花费', '订单', '销售额']
DISPLAY_RULES = {'关键词/PAT暂停', '产品(ASIN)暂停', '否词'}


def split_dashboard(source, output):
    source = Path(source)
    output = Path(output)
    raw = source.read_bytes()
    payload = json.loads(raw)
    version = hashlib.sha256(raw).hexdigest()[:16]
    relative = Path('dashboard') / f'v1-{version}'
    folder = output / relative
    folder.mkdir(parents=True, exist_ok=True)

    def save(name, value):
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
        return (relative / name).as_posix()

    modules = {}
    for key in ['monthly_review', 'invalid_low_efficiency', 'batch_launch', 'lingxing_rules']:
        value = payload[key]
        if key == 'lingxing_rules':
            value = {**value, 'action_detail': {k: v for k, v in value['action_detail'].items() if k not in ['rows', 'special_rows']}}
            value['action_detail'].update(rows=[], special_rows=[])
            lazy_details = {}
            for kind, source_key, chunk_size in [('main', 'rows', 70), ('special', 'special_rows', 100)]:
                rows = payload[key]['action_detail'][source_key]
                if kind == 'main':
                    rows = [r for r in rows if r.get('规则类别') in DISPLAY_RULES]
                rows = sorted(rows, key=lambda r: str(r.get('触发日期', '')), reverse=True)
                chunks = [save(f'{kind}/chunk-{i // chunk_size:04}.json', rows[i:i + chunk_size]) for i in range(0, len(rows), chunk_size)]
                dictionaries, codes = [], []
                for field in DETAIL_FIELDS:
                    values, lookup, column = [], {}, []
                    for row in rows:
                        field_value = row.get(field)
                        token = json.dumps(field_value, ensure_ascii=False)
                        if token not in lookup:
                            lookup[token] = len(values)
                            values.append(field_value)
                        column.append(lookup[token])
                    dictionaries.append(values)
                    codes.append(column)
                encoded = [list(values) for values in zip(*codes)]
                assert [[dictionaries[i][v] for i, v in enumerate(values)] for values in encoded] == [[r.get(f) for f in DETAIL_FIELDS] for r in rows]
                index = {'fields': DETAIL_FIELDS, 'dictionaries': dictionaries, 'rows': encoded, 'chunks': chunks, 'chunk_size': chunk_size}
                index_path = save(f'{kind}/index.json', index)
                lazy_details[kind] = {'index': index_path, 'total': len(rows)}
                # Verify all visible native records, metrics, order and identities are preserved.
                rebuilt = [r for path in chunks for r in json.loads((output / path).read_text())]
                assert rebuilt == rows, kind
            value['lazy_details'] = lazy_details
        path = save(f'{key}.json', value)
        modules[key] = path
        if key != 'lingxing_rules':
            assert json.loads((output / path).read_text()) == payload[key], key
    manifest = {'schema_version': 1, 'version': version, 'meta': payload['meta'], 'modules': modules}
    output.mkdir(parents=True, exist_ok=True)
    (output / 'dashboard_manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('source_sha256=', hashlib.sha256(raw).hexdigest())
    print('manifest=', output / 'dashboard_manifest.json')
    print('action_records=', lazy_details)
    for key, path in modules.items():
        print(key, (output / path).stat().st_size, 'bytes')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    split_dashboard(args.input, args.output_dir)
