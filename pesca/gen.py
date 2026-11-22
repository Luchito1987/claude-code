W=800
out=[]
a=out.append
a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="1560" viewBox="0 0 {W} 1560" font-family="Arial, Helvetica, sans-serif">')
a('<defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#d6453d"/></marker></defs>')
a(f'<rect width="{W}" height="1560" fill="#f7f4ee"/>')
a('<text x="400" y="58" text-anchor="middle" font-size="36" font-weight="bold" fill="#1f2a36">Anzuelo directo en el lazo</text>')
a('<text x="400" y="94" text-anchor="middle" font-size="21" fill="#5a6470">Solo con el nylon de 60 lb · sin brazolada</text>')
LINE='#8fb3cc'; LOOP='#3d6e91'; HOOK='#6b7177'
def hook(ex,ey):
    a(f'<path d="M{ex} {ey+9} L{ex} {ey+110} Q{ex} {ey+150} {ex-35} {ey+150} Q{ex-65} {ey+150} {ex-65} {ey+112}" fill="none" stroke="{HOOK}" stroke-width="6" stroke-linecap="round"/>')
    a(f'<path d="M{ex-65} {ey+112} l14 12" stroke="{HOOK}" stroke-width="5" stroke-linecap="round"/>')
def eye(ex,ey):
    a(f'<circle cx="{ex}" cy="{ey}" r="10" fill="none" stroke="{HOOK}" stroke-width="5"/>')
def knot(y):
    a(f'<rect x="141" y="{y-14}" width="18" height="28" rx="6" fill="{LOOP}"/>')
    for i in range(4):
        a(f'<line x1="140" y1="{y-10+i*7}" x2="160" y2="{y-6+i*7}" stroke="#244a66" stroke-width="2"/>')
def panel(top,n,title,sub):
    a(f'<rect x="30" y="{top}" width="740" height="310" rx="16" fill="#fff" stroke="#e1dbcf" stroke-width="2"/>')
    a(f'<circle cx="70" cy="{top+40}" r="22" fill="#d6453d"/><text x="70" y="{top+48}" text-anchor="middle" font-size="24" font-weight="bold" fill="#fff">{n}</text>')
    a(f'<text x="105" y="{top+40}" font-size="23" font-weight="bold" fill="#1f2a36">{title}</text>')
    a(f'<text x="105" y="{top+68}" font-size="18" fill="#5a6470">{sub}</text>')
    a(f'<line x1="150" y1="{top+90}" x2="150" y2="{top+295}" stroke="{LINE}" stroke-width="7"/>')

# Panel 1
t=130; panel(t,1,'Haz un dropper loop largo','Círculo de unos 20 cm → el lazo queda de 8–10 cm')
y=t+190
a(f'<path d="M150 {y-8} C 260 {y-34}, 420 {y-30}, 450 {y} C 420 {y+30}, 260 {y+34}, 150 {y+8}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
knot(y)
a(f'<line x1="170" y1="{y+60}" x2="450" y2="{y+60}" stroke="#1f2a36" stroke-width="2"/><line x1="170" y1="{y+52}" x2="170" y2="{y+68}" stroke="#1f2a36" stroke-width="2"/><line x1="450" y1="{y+52}" x2="450" y2="{y+68}" stroke="#1f2a36" stroke-width="2"/>')
a(f'<text x="310" y="{y+90}" text-anchor="middle" font-size="18" fill="#1f2a36">8–10 cm</text>')
a(f'<text x="490" y="{y+5}" font-size="18" fill="#5a6470">5 torsiones,</text><text x="490" y="{y+29}" font-size="18" fill="#5a6470">bien mojado</text>')

# Panel 2
t=460; panel(t,2,'Pasa la punta del lazo por el ojo','Mete el lazo por el ojito del anzuelo')
y=t+125; ex=470
a(f'<path d="M150 {y-8} C 260 {y-30}, 420 {y-14}, 520 {y-6} Q 540 {y} 520 {y+6} C 420 {y+14}, 260 {y+30}, 150 {y+8}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
knot(y)
eye(ex,y); hook(ex,y)
a(f'<path d="M560 {y-40} Q 600 {y-10} 545 {y}" fill="none" stroke="#d6453d" stroke-width="3" marker-end="url(#ar)"/>')
a(f'<text x="570" y="{y-50}" font-size="18" fill="#d6453d" font-weight="bold">sale por aquí</text>')

# Panel 3
t=790; panel(t,3,'Abre el lazo y pasa el anzuelo','El anzuelo entero entra por dentro del lazo')
y=t+130; ex=470
a(f'<path d="M150 {y-8} C 260 {y-24}, 400 {y-10}, {ex-6} {y}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
a(f'<path d="M150 {y+8} C 260 {y+20}, 400 {y+12}, {ex-6} {y+4}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
knot(y)
a(f'<path d="M{ex+6} {y-2} C 560 {y-20}, 600 {y+60}, 580 {y+120} C 560 {y+160}, 420 {y+168}, 385 {y+130} C 355 {y+95}, 380 {y+30}, {ex+6} {y+4}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
eye(ex,y); hook(ex,y)
a(f'<path d="M650 {y+105} C 680 {y+60}, 660 {y+20}, 610 {y}" fill="none" stroke="#d6453d" stroke-width="3" marker-end="url(#ar)"/>')
a(f'<text x="615" y="{y+135}" font-size="17" fill="#d6453d" font-weight="bold">el anzuelo pasa</text><text x="615" y="{y+155}" font-size="17" fill="#d6453d" font-weight="bold">por dentro del lazo</text>')

# Panel 4
t=1120; panel(t,4,'Tira y ajusta','El lazo queda abrazando el ojo del anzuelo')
y=t+130; ex=470
a(f'<path d="M150 {y-8} C 260 {y-24}, 400 {y-12}, {ex-8} {y-4}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
a(f'<path d="M150 {y+8} C 260 {y+20}, 400 {y+12}, {ex-8} {y+6}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
knot(y)
eye(ex,y)
a(f'<path d="M{ex-9} {y-6} Q {ex} {y-22} {ex+10} {y-6} Q {ex+16} {y+8} {ex+2} {y+14} Q {ex-12} {y+14} {ex-9} {y+6}" fill="none" stroke="{LOOP}" stroke-width="5"/>')
hook(ex,y)
a(f'<path d="M110 {y+60} L 110 {y-40}" stroke="#d6453d" stroke-width="3" marker-end="url(#ar)"/>')
a(f'<path d="M545 {y+60} L 545 {y+130}" stroke="#d6453d" stroke-width="3" marker-end="url(#ar)"/>')
a(f'<text x="560" y="{y+100}" font-size="18" fill="#d6453d" font-weight="bold">tira del anzuelo</text>')
a(f'<text x="560" y="{y-10}" font-size="20" fill="#2e7d4f" font-weight="bold">✓ Listo</text>')

a('<rect x="30" y="1450" width="740" height="90" rx="14" fill="#fff" stroke="#d9d3c7" stroke-width="2"/>')
a('<text x="400" y="1486" text-anchor="middle" font-size="20" fill="#1f2a36">Haz lo mismo en el segundo lazo.</text>')
a('<text x="400" y="1518" text-anchor="middle" font-size="20" fill="#1f2a36">Para cambiar el anzuelo: afloja el lazo y saca el anzuelo por dentro.</text>')
a('</svg>')
open('lazo-anzuelo.svg','w').write('\n'.join(out))
