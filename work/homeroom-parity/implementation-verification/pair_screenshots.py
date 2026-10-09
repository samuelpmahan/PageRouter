#!/usr/bin/env python3
"""Pair diagnostic PNG captures at original scale; source LEFT, implementation RIGHT.

No third-party imaging dependency. Supports ordinary 8-bit browser PNGs (RGB/RGBA).
Full-page heights may differ. Padding is explicit, never resizes/crops silently.
"""
import argparse, hashlib, json, pathlib, struct, zlib

def read_png(path):
    raw=path.read_bytes()
    if raw[:8]!=b'\x89PNG\r\n\x1a\n': raise ValueError('not PNG')
    offset=8; compressed=[]; header=None
    while offset<len(raw):
        size=struct.unpack('>I',raw[offset:offset+4])[0]
        kind=raw[offset+4:offset+8]; payload=raw[offset+8:offset+8+size]
        if kind==b'IHDR': header=struct.unpack('>IIBBBBB',payload)
        if kind==b'IDAT': compressed.append(payload)
        offset+=size+12
    width,height,depth,color,compression,filtering,interlace=header
    if depth!=8 or color not in (2,6) or compression or filtering or interlace:
        raise ValueError(f'unsupported PNG format: {header}')
    if width*height>30_000_000: raise ValueError('bounded diagnostic size exceeded')
    channels=3 if color==2 else 4; stride=width*channels
    packed=zlib.decompress(b''.join(compressed))
    if len(packed)!=(stride+1)*height: raise ValueError('invalid PNG scanline length')
    rows=[]; previous=bytearray(stride)
    for y in range(height):
        at=y*(stride+1); mode=packed[at]; row=bytearray(packed[at+1:at+1+stride])
        for x in range(stride):
            a=row[x-channels] if x>=channels else 0; b=previous[x]; c=previous[x-channels] if x>=channels else 0
            if mode==1: predictor=a
            elif mode==2: predictor=b
            elif mode==3: predictor=(a+b)//2
            elif mode==4:
                p=a+b-c; pa=abs(p-a);pb=abs(p-b);pc=abs(p-c)
                predictor=a if pa<=pb and pa<=pc else b if pb<=pc else c
            elif mode==0: predictor=0
            else: raise ValueError('invalid PNG filter')
            row[x]=(row[x]+predictor)&255
        previous=row
        if channels==3:
            rgba=bytearray(width*4)
            for x in range(width): rgba[4*x:4*x+4]=row[3*x:3*x+3]+b'\xff'
            row=rgba
        rows.append(bytes(row))
    return width,height,rows

def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)

def write_png(path,width,height,rows):
    packed=b''.join(b'\x00'+row for row in rows)
    raw=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(packed,6))+chunk(b'IEND',b'')
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=pathlib.Path);p.add_argument('implementation',type=pathlib.Path);p.add_argument('output',type=pathlib.Path)
    p.add_argument('--width',type=int,required=True,help='Expected CSS viewport width at density 1')
    p.add_argument('--top',type=int,default=0);p.add_argument('--height',type=int,help='Optional same-coordinate focused crop; zero padding explicit')
    args=p.parse_args();sw,sh,srows=read_png(args.source);iw,ih,irows=read_png(args.implementation)
    if sw!=args.width or iw!=args.width: raise ValueError(f'Equal viewport/density required: source={sw}, implementation={iw}, expected={args.width}')
    if args.top<0 or args.top>=min(sh,ih):raise ValueError('crop top outside compared captures')
    height=args.height or max(sh,ih)-args.top
    if height<=0 or height*(sw+iw+8)>30_000_000:raise ValueError('bounded diagnostic size exceeded')
    pad=bytes((15,23,42,255))*sw;gutter=bytes((220,220,220,255))*8
    rows=[(srows[y] if y<sh else pad)+gutter+(irows[y] if y<ih else pad) for y in range(args.top,args.top+height)]
    write_png(args.output,sw+iw+8,height,rows)
    receipt={'schema':'hh-comparison-pair.v1','left':{'path':str(args.source.resolve()),'sha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),'pixels':[sw,sh]},'right':{'path':str(args.implementation.resolve()),'sha256':hashlib.sha256(args.implementation.read_bytes()).hexdigest(),'pixels':[iw,ih]},'output':str(args.output.resolve()),'pixels':[sw+iw+8,height],'cssViewportWidth':args.width,'density':1,'scale':1,'cropTop':args.top,'cropHeight':args.height,'padding':'navy below shorter full-page capture; no resize','note':'Opening this combined image is required before a visual verdict.'}
    args.output.with_suffix('.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'output':str(args.output),'pixels':receipt['pixels']}))

if __name__=='__main__':main()
