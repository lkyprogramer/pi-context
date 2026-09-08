#!/usr/bin/env python3
"""Rebuild a Git tree from a GitHub single-root source ZIP without extraction.
No network, no repository mutation. Preserves executable/symlink modes from ZIP.
"""
import argparse, hashlib, json, stat, zipfile
from pathlib import Path, PurePosixPath

def git_obj(kind, body):
    return hashlib.sha1(kind.encode()+b' '+str(len(body)).encode()+b'\0'+body).digest()

def verify(path, expected):
    root={};count=0;seen=set();prefix=None
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            if i.is_dir():continue
            parts=PurePosixPath(i.filename).parts
            if len(parts)<2 or '..' in parts or PurePosixPath(i.filename).is_absolute():
                raise ValueError('ZIP must have a single safe source root')
            if prefix is None:prefix=parts[0]
            if parts[0]!=prefix:raise ValueError('multiple source roots')
            name='/'.join(parts[1:])
            if name in seen:raise ValueError('duplicate file')
            seen.add(name)
            node=root
            for p in parts[1:-1]:
                node=node.setdefault(p,{})
                if not isinstance(node,dict):raise ValueError('path type collision')
            mode=(i.external_attr>>16)&0xffff
            typ='120000' if stat.S_ISLNK(mode) else '100755' if mode&0o111 else '100644'
            node[parts[-1]]=(typ,git_obj('blob',z.read(i)));count+=1
        comment=z.comment.decode('utf8','replace')
    def tree(node):
        entries=[]
        for n,v in node.items():
            if isinstance(v,dict):entries.append((n+'/',b'40000 '+n.encode()+b'\0'+tree(v)))
            else:entries.append((n,v[0].encode()+b' '+n.encode()+b'\0'+v[1]))
        return git_obj('tree',b''.join(v for _,v in sorted(entries,key=lambda x:x[0].encode())))
    got=tree(root).hex()
    return {'archive':path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'files':count,'zip_comment':comment,'computedGitTree':got,'expectedGitTree':expected,'match':got==expected}

def main():
    p=argparse.ArgumentParser();p.add_argument('zip',type=Path);p.add_argument('--tree',required=True);p.add_argument('--out',type=Path)
    a=p.parse_args();r=verify(a.zip,a.tree);text=json.dumps(r,ensure_ascii=False,indent=2)+'\n'
    if a.out:a.out.write_text(text,encoding='utf8')
    print(text,end='')
    raise SystemExit(0 if r['match'] else 1)
if __name__=='__main__':main()
