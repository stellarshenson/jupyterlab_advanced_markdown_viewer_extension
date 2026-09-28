#!/usr/bin/env python3
"""Watch the comment threads that jupyterlab_advanced_markdown_viewer_extension keeps in
Markdown files, and print one line for each thread the user adds to.

`run` reads the list again every 5 seconds, so `add` and `remove` take effect without a
restart. It prints one line per event, flushed at once:

  <file name> | watching
  <file name> | missing
  <file name> | new note <mark id, 8 chars> | <last line of the thread>
  <file name> | reply <mark id, 8 chars> | <last line of the thread>

A thread is reported when its comment lines change and its last line is not signed by
--me. A closed mark (status=closed) and a change of colour are not reported. The first
pass over a file reports every open thread whose last line is not signed by --me.
"""
import argparse
import hashlib
import os
import re
import time

MARK = re.compile(r'<!-- mark:([0-9a-f-]{36})(.*?)-->', re.S)
HEAD = r'@([A-Za-z0-9._-]+) \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z:'
AUTHOR = re.compile(HEAD)
FIRST_HEAD = re.compile(r'(?:^|[ \t])' + HEAD)
CLOSED = re.compile(r'(?:^|\s)status=closed(?:\s|$)')


def thread(body):
    """Split the text of an opening marker into its attributes and its comment lines.

    A marker in a table row or on a quote line holds its comments on its one line,
    joined by a literal backslash and n, after the attributes.
    """
    first, newline, rest = body.partition('\n')
    if newline:
        return first, rest
    head = FIRST_HEAD.search(first)
    return (first[:head.start()], first[head.start():]) if head else (first, '')


def scan(known, text, me):
    """Compare the threads of one file's text with those seen before.

    `known` maps a mark id to the digest of its comment lines at the last pass.
    Returns the events of this pass and the map for the next one.
    """
    current, events = {}, []
    for match in MARK.finditer(text):
        mark_id, body = match.group(1), match.group(2)
        if mark_id in current:
            continue  # a copied marker repeats an id; the first one is the mark
        attributes, notes = thread(body)
        digest = hashlib.sha1(notes.encode()).hexdigest()[:8]
        current[mark_id] = digest
        if known.get(mark_id) == digest or CLOSED.search(attributes):
            continue
        authors = AUTHOR.findall(notes)
        if not authors or authors[-1] == me:
            continue  # a mark with no comment, or my own line last
        kind = 'new note' if mark_id not in known else 'reply'
        lines = [line.strip() for line in notes.replace('\\n', '\n').splitlines()]
        last = [line for line in lines if line][-1][:200]
        events.append(f'{kind} {mark_id[:8]} | {last}')
    return events, current


def read_list(list_path):
    try:
        with open(list_path, encoding='utf8') as handle:
            return [line.strip() for line in handle if line.strip()]
    except OSError:
        return []


def write_list(list_path, paths):
    os.makedirs(os.path.dirname(list_path) or '.', exist_ok=True)
    with open(list_path, 'w', encoding='utf8') as handle:
        handle.write(''.join(path + '\n' for path in paths))


def run(list_path, me):
    state, missing = {}, set()
    while True:
        paths = read_list(list_path)
        for gone in [path for path in state if path not in paths]:
            del state[gone]
        for path in paths:
            name = os.path.basename(path)
            try:
                with open(path, encoding='utf8') as handle:
                    text = handle.read()
            except OSError:
                if path not in missing:
                    missing.add(path)
                    print(f'{name} | missing', flush=True)
                continue
            missing.discard(path)
            if path not in state:
                state[path] = {}
                print(f'{name} | watching', flush=True)
            events, state[path] = scan(state[path], text, me)
            for event in events:
                print(f'{name} | {event}', flush=True)
        time.sleep(5)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('action', choices=['add', 'remove', 'show', 'run'],
                        help='add or remove files, show the list, or watch every file in it')
    parser.add_argument('--list', required=True,
                        help='the watch list, one absolute path per line; one per session')
    parser.add_argument('--me', default='claude',
                        help='the handle your own comment lines carry (default: claude)')
    parser.add_argument('files', nargs='*', help='the Markdown files to add or remove')
    args = parser.parse_args()
    list_path = os.path.abspath(args.list)
    files = [os.path.abspath(path) for path in args.files]
    paths = read_list(list_path)
    if args.action == 'add':
        for path in files:
            if not os.path.isfile(path):
                parser.exit(1, f'not a file: {path}\n')
            if path not in paths:
                paths.append(path)
        write_list(list_path, paths)
    elif args.action == 'remove':
        write_list(list_path, [path for path in paths if path not in files])
    if args.action == 'run':
        run(list_path, args.me)
    else:
        print('\n'.join(read_list(list_path)) or '(empty)')


if __name__ == '__main__':
    main()
