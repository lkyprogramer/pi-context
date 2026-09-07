#!/usr/bin/env python3
"""Recompute the Git tree of a source ZIP against the recorded audit baseline.
Reads ZIP entries without extraction. Does not fetch the current GitHub head.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


def git_hash(kind: str, data: bytes) -> bytes:
    return hashlib.sha1(kind.encode()+b' '+str(len(data)).encode()+b'\0'+data).digest()


def verify(archive: Path, expected: dict) -> dict:
    h=hashlib.sha256()
    with archive.open('rb') as stream:
        for part in iter(lambda:stream.read(1024*1024),b''):h.update(part)
    tree={};files=0
    with zipfile.ZipFile(archive) as z:
        infos=[x for x in z.infolist() if not x.is_dir()]
        names=[PurePosixPath(x.filename).parts for x in infos]
        if not names:raise ValueError('empty ZIP')
        prefix=names[0][0] if all(len(x)>1 and x[0]==names[0][0] for x in names) else None
        for info in infos:
            p=PurePosixPath(info.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in info.filename:
                raise ValueError('unsafe ZIP entry name')
            parts=p.parts[1:] if prefix else p.parts
            if not parts:continue
            if info.file_size>512*1024*1024:raise ValueError('oversized archive entry')
            mode=(info.external_attr>>16)&0xffff
            gitmode=b'120000' if stat.S_ISLNK(mode) else b'100755' if mode&0o111 else b'100644'
            blob=git_hash('blob',z.read(info))
            parent=tree
            for part in parts[:-1]:
                old=parent.setdefault(part,{})
                if not isinstance(old,dict):raise ValueError('file/directory conflict')
                parent=old
            if parts[-1] in parent:raise ValueError('duplicate archive path')
            parent[parts[-1]]=(gitmode,blob);files+=1
    def digest(node: dict) -> bytes:
        data=b''
        for name,value in sorted(node.items(),key=lambda x:(x[0]+('/' if isinstance(x[1],dict) else '')).encode('utf-8')):
            mode,body=(b'40000',digest(value)) if isinstance(value,dict) else value
            data+=mode+b' '+name.encode('utf-8')+b'\0'+body
        return git_hash('tree',data)
    got=digest(tree).hex()
    okay=h.hexdigest()==expected['attachmentSha256'] and got==expected['githubTree'] and files==expected['files']
    return {'kind':'source-archive-identity','status':'passed' if okay else 'failed',
            'archiveSha256':h.hexdigest(),'gitTree':got,'files':files,
            'matchesRecordedBaseline':okay,'githubRefetched':False}


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('archive',type=Path)
    ap.add_argument('--manifest',type=Path,default=Path(__file__).resolve().parents[1]/'evidence/source-identity.json')
    ap.add_argument('--output',type=Path);args=ap.parse_args()
    try:r=verify(args.archive,json.loads(args.manifest.read_text()))
    except (OSError,ValueError,zipfile.BadZipFile,KeyError) as exc:r={'kind':'source-archive-identity','status':'failed','error':str(exc)}
    text=json.dumps(r,ensure_ascii=False,indent=2)+'\n';print(text,end='')
    if args.output:args.output.write_text(text)
    return 0 if r['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
