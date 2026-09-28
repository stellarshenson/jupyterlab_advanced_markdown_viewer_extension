#!/usr/bin/env python3
"""Watch the comment threads that jupyterlab_advanced_markdown_viewer_extension keeps in
Markdown files, and print one line for each thread the user adds to.

`run` reads the list again every 5 seconds, so `add` and `remove` take effect without a
restart. It prints one line per event, flushed at once:

  <file name> | watching
  <file name> | missing
  <file name> | new note <mark id, 8 chars> | <last new line not signed by --me>
  <file name> | reply <mark id, 8 chars> | <last new line not signed by --me>

A thread is reported when a line not signed by --me is added to it or changed, even when
a line signed by --me follows it. A closed mark (status=closed) and a change of colour
are not reported. The first pass over a file reports every open thread whose last line
is not signed by --me. A file added again after `remove` keeps the threads already seen
and reports only those that changed.
"""
import argparse
import os
import re
import sys
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
    if not head:
        return first, ''
    notes = re.sub(r'\\([\\n|])', lambda m: '\n' if m[1] == 'n' else m[1], first[head.start():])
    return first[:head.start()], notes


def scan(known, text, me):
    """Compare the threads of one file's text with those seen before.

    `known` maps a mark id to its comment lines not signed by `me` at the last pass.
    Returns the events of this pass and the map for the next one.
    """
    current, events = {}, []
    for match in MARK.finditer(text):
        mark_id, body = match.group(1), match.group(2)
        if mark_id in current:
            continue  # a copied marker repeats an id; the first one is the mark
        attributes, notes = thread(body)
        author, theirs = None, []
        for line in notes.splitlines():
            line = line.strip()
            head = AUTHOR.match(line)
            author = head.group(1) if head else author
            if line and author != me:
                theirs.append(line)
        current[mark_id] = theirs
        added = [line for line in theirs if line not in known.get(mark_id, [])]
        if not added or CLOSED.search(attributes):
            continue
        if mark_id not in known and author == me:
            continue  # first sight of a thread whose last line is mine
        kind = 'new note' if mark_id not in known else 'reply'
        events.append(f'{kind} {mark_id[:8]} | {added[-1][:200]}')
    return events, {**known, **current}


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
        for path in paths:
            name = os.path.basename(path)
            try:
                with open(path, encoding='utf8', errors='replace') as handle:
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
    sys.stdout.reconfigure(encoding='utf-8')
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
