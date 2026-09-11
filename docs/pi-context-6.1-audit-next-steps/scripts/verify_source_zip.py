"""Recompute a GitHub archive tree including executable bits. No extraction."""
import argparse, hashlib, json, stat, zipfile
from pathlib import Path, PurePosixPath

def tree_hash(d):
    rows=[]
    for name,value in d.items():
        isdir=isinstance(value,dict)
        mode,sha=(b'40000',tree_hash(value)) if isdir else value
        rows.append((name.encode()+ (b'/' if isdir else b''),mode+b' '+name.encode()+b'\0'+sha))
    body=b''.join(body for _,body in sorted(rows))
    return hashlib.sha1(b'tree '+str(len(body)).encode()+b'\0'+body).digest()

def inspect(path):
    root={};total=0
    with zipfile.ZipFile(path) as z:
        prefixes={PurePosixPath(i.filename).parts[0] for i in z.infolist() if i.filename}
        if len(prefixes)!=1:raise ValueError('Expected a single GitHub archive root')
        for i in z.infolist():
            if i.is_dir():continue
            parts=PurePosixPath(i.filename).parts[1:]
            if not parts or '..' in parts:raise ValueError('Unsafe or empty path')
            node=root
            for part in parts[:-1]:node=node.setdefault(part,{})
            if parts[-1] in node:raise ValueError('Duplicate file path')
            mode=i.external_attr>>16
            m=b'120000' if stat.S_ISLNK(mode) else b'100755' if mode&0o111 else b'100644'
            data=z.read(i);sha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).digest()
            node[parts[-1]]=(m,sha);total+=1
        comment=z.comment.decode('utf8',errors='replace')
    return dict(fileCount=total,gitTree=tree_hash(root).hex(),zipComment=comment,
        bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zip',type=Path);p.add_argument('--expected-tree',required=True);a=p.parse_args()
    result=inspect(a.zip);result['verified']=result['gitTree']==a.expected_tree
    print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result['verified'] else 1)
