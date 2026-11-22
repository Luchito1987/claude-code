import math
W=800;H=1620
out=[];a=out.append
LOOP='#3d6e91';DARK='#244a66'
a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Arial, Helvetica, sans-serif">')
a('<defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#d6453d"/></marker></defs>')
a(f'<rect width="{W}" height="{H}" fill="#f7f4ee"/>')
a('<text x="400" y="58" text-anchor="middle" font-size="36" font-weight="bold" fill="#1f2a36">Dropper loop paso a paso</text>')
a('<text x="400" y="94" text-anchor="middle" font-size="21" fill="#5a6470">El lazo que sale del costado del nylon</text>')
def panel(top,n,title,sub,sub2=''):
    a(f'<rect x="30" y="{top}" width="740" height="320" rx="16" fill="#fff" stroke="#e1dbcf" stroke-width="2"/>')
    a(f'<circle cx="70" cy="{top+40}" r="22" fill="#d6453d"/><text x="70" y="{top+48}" text-anchor="middle" font-size="24" font-weight="bold" fill="#fff">{n}</text>')
    a(f'<text x="105" y="{top+40}" font-size="23" font-weight="bold" fill="#1f2a36">{title}</text>')
    a(f'<text x="105" y="{top+68}" font-size="18" fill="#5a6470">{sub}</text>')
    if sub2: a(f'<text x="105" y="{top+92}" font-size="18" fill="#5a6470">{sub2}</text>')
def p(d,w=5,c=LOOP): a(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
def twist(x0,x1,y,turns,amp=9):
    for ph,col in ((0,LOOP),(math.pi,DARK)):
        pts=[]
        n=60
        for i in range(n+1):
            x=x0+(x1-x0)*i/n
            pts.append(f'{x:.1f},{y+amp*math.sin(2*math.pi*turns*i/n+ph):.1f}')
        a(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{col}" stroke-width="5" stroke-linecap="round"/>')
def arrow(d): a(f'<path d="{d}" fill="none" stroke="#d6453d" stroke-width="3" marker-end="url(#ar)"/>')
def note(x,y,t,c="#d6453d"): a(f'<text x="{x}" y="{y}" font-size="17" fill="{c}" font-weight="bold">{t}</text>')

# 1
t=125; panel(t,1,'Haz un círculo con el nylon','Cruza el nylon sobre sí mismo. Círculo de unos 20 cm')
y=t+280
p(f'M80 {y} L400 {y} C 500 {y}, 500 {y-160}, 400 {y-160} C 300 {y-160}, 300 {y}, 400 {y} L720 {y}')
a(f'<circle cx="400" cy="{y}" r="16" fill="none" stroke="#d6453d" stroke-width="2" stroke-dasharray="4 3"/>')
note(430,y+30,'se cruzan aquí')
note(80,y-20,'hacia el carrete',"#5a6470"); note(600,y-20,'hacia el plomo',"#5a6470")

# 2
t=465; panel(t,2,'Retuerce los lados del cruce 5–7 veces','Gira el círculo como si enroscaras.','Deja un hueco en el centro de las torsiones.')
y=t+250
p(f'M80 {y} L270 {y}')
twist(270,385,y,3)
twist(415,530,y,3)
p(f'M530 {y} L720 {y}')
p(f'M385 {y} C 370 {y-50}, 360 {y-130}, 400 {y-135} C 440 {y-130}, 430 {y-50}, 415 {y}')
a(f'<circle cx="400" cy="{y}" r="13" fill="none" stroke="#d6453d" stroke-width="2.5"/>')
note(380,y+42,'← el hueco')
note(440,y-100,'el círculo queda arriba',"#5a6470")

# 3
t=805; panel(t,3,'Pasa la parte de arriba por el hueco','Baja la punta del círculo y métela por el','hueco del centro, hacia el otro lado.')
y=t+190
p(f'M80 {y} L270 {y}')
twist(270,385,y,3)
twist(415,530,y,3)
p(f'M530 {y} L720 {y}')
p(f'M385 {y} C 375 {y-30}, 395 {y-30}, 398 {y} L 396 {y+60} C 395 {y+95}, 405 {y+95}, 404 {y+60} L 402 {y} C 405 {y-30}, 425 {y-30}, 415 {y}')
arrow(f'M470 {y-60} C 470 {y+20}, 450 {y+70}, 415 {y+90}')
note(480,y-50,'empuja hacia abajo')
note(420,y+115,'el lazo sale por debajo',"#5a6470")

# 4
t=1145; panel(t,4,'Moja y tira de las dos puntas','Sujeta el lazo con un dedo o un lápiz mientras','tiras. Las vueltas se juntan solas.')
y=t+190
p(f'M80 {y} L355 {y}')
twist(355,445,y,5,amp=7)
p(f'M445 {y} L720 {y}')
p(f'M394 {y+6} C 380 {y+60}, 385 {y+105}, 400 {y+108} C 415 {y+105}, 420 {y+60}, 406 {y+6}')
arrow(f'M230 {y-25} L120 {y-25}')
arrow(f'M570 {y-25} L680 {y-25}')
note(140,y-38,'tira'); note(600,y-38,'tira')
note(430,y+95,'✓ el lazo queda de lado',"#2e7d4f")

a(f'<rect x="30" y="1485" width="740" height="115" rx="14" fill="#fff" stroke="#d9d3c7" stroke-width="2"/>')
a('<text x="400" y="1522" text-anchor="middle" font-size="20" fill="#1f2a36">Con nylon de 60 lb: usa 5 torsiones y apriétalo bien mojado.</text>')
a('<text x="400" y="1554" text-anchor="middle" font-size="20" fill="#1f2a36">Si quieres un lazo más largo, empieza con un círculo más grande.</text>')
a('<text x="400" y="1586" text-anchor="middle" font-size="20" fill="#1f2a36">Si queda torcido o flojo, deshazlo y repite: es normal al principio.</text>')
a('</svg>')
open('dropper-loop.svg','w').write('\n'.join(out))
