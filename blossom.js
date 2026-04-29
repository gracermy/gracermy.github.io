// ShaderRunner — loads a fragment shader onto a full-canvas quad
window.ShaderRunner = (function(){
  const VERT = `
    attribute vec2 aPos;
    void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  function compile(gl, type, src){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function attach(canvas, fragSource, opts){
    opts = opts || {};
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false });
    if(!gl) return null;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      throw new Error(gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime     = gl.getUniformLocation(prog, 'uTime');
    const uRes      = gl.getUniformLocation(prog, 'uResolution');
    const uMouse    = gl.getUniformLocation(prog, 'uMouse');
    const uClick    = gl.getUniformLocation(prog, 'uClick');
    const uClickTime= gl.getUniformLocation(prog, 'uClickTime');

    const state = {
      mouse: [0, 0], targetMouse: [0, 0],
      click: [0, 0], clickTime: -1000,
      startTime: performance.now()/1000,
      running: false, raf: null,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    };

    function resize(){
      const w = Math.max(1, Math.floor(window.innerWidth  * state.dpr));
      const h = Math.max(1, Math.floor(window.innerHeight * state.dpr));
      if(canvas.width !== w || canvas.height !== h){
        canvas.width = w; canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function setMouse(clientX, clientY){
      state.targetMouse = [
        clientX * state.dpr,
        (window.innerHeight - clientY) * state.dpr
      ];
    }

    function onMove(ev)  { setMouse(ev.clientX, ev.clientY); }
    function onClick(ev) { setMouse(ev.clientX, ev.clientY); state.click = state.targetMouse.slice(); state.clickTime = performance.now()/1000 - state.startTime; }
    function onTouch(ev) { if(ev.touches[0]) setMouse(ev.touches[0].clientX, ev.touches[0].clientY); }
    function onTouchStart(ev){ if(ev.touches[0]){ onTouch(ev); state.click = state.targetMouse.slice(); state.clickTime = performance.now()/1000 - state.startTime; } }

    window.addEventListener('mousemove',  onMove);
    window.addEventListener('mousedown',  onClick);
    window.addEventListener('touchmove',  onTouch,      {passive:true});
    window.addEventListener('touchstart', onTouchStart, {passive:true});
    window.addEventListener('resize',     resize);
    resize();
    // seed mouse to center
    state.mouse = state.targetMouse = [canvas.width/2, canvas.height/2];

    function frame(){
      if(!state.running) return;
      state.mouse[0] += (state.targetMouse[0] - state.mouse[0]) * 0.12;
      state.mouse[1] += (state.targetMouse[1] - state.mouse[1]) * 0.12;
      resize();
      const t = performance.now()/1000 - state.startTime;
      gl.uniform1f(uTime,      t);
      gl.uniform2f(uRes,       canvas.width, canvas.height);
      gl.uniform2f(uMouse,     state.mouse[0], state.mouse[1]);
      gl.uniform2f(uClick,     state.click[0], state.click[1]);
      gl.uniform1f(uClickTime, state.clickTime);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      state.raf = requestAnimationFrame(frame);
    }

    return {
      start(){ if(!state.running){ state.running = true; frame(); } },
      stop() { state.running = false; if(state.raf) cancelAnimationFrame(state.raf); }
    };
  }

  return { attach };
})();

// Cherry Blossom fragment shader
window.FRAG_BLOSSOM = `
precision highp float;
uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;
uniform vec2  uClick;
uniform float uClickTime;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec2 hash2(vec2 p){
  return fract(sin(vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))))*43758.5453);
}
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.1; a*=0.5; }
  return v;
}
float petal(vec2 p, float rot, float sz){
  float c=cos(rot), s=sin(rot);
  p = mat2(c,-s,s,c)*p / sz;
  float r=length(p), a=atan(p.y,p.x);
  float shape=0.6+0.4*cos(a);
  return smoothstep(shape, shape-0.2, r);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = uv; p.x *= aspect;
  vec2 m = uMouse / uResolution.xy; m.x *= aspect;

  // sky gradient: peach -> pale lavender
  vec3 sky = mix(vec3(1.0,0.92,0.88), vec3(0.85,0.82,0.95), uv.y);
  sky = mix(sky, vec3(0.95,0.88,0.92), smoothstep(0.4,0.0,uv.y));
  vec3 col = sky;

  // soft bokeh
  for(int i=0;i<6;i++){
    float fi=float(i);
    vec2 bp=hash2(vec2(fi,7.3))*vec2(aspect,1.0);
    bp.x+=sin(uTime*0.1+fi)*0.1;
    bp.y+=cos(uTime*0.15+fi*1.7)*0.05;
    col += vec3(1.0,0.85,0.9)*exp(-length(p-bp)*8.0)*0.15;
  }

  // mouse vortex
  vec2 toMouse=p-m;
  float md=length(toMouse);
  float vortex=exp(-md*2.5);
  float ang=atan(toMouse.y,toMouse.x)+vortex*2.5;

  // click gust
  float clickAge=uTime-uClickTime;
  vec2 cp=uClick/uResolution.xy; cp.x*=aspect;
  float gust=exp(-clickAge*1.2)*smoothstep(0.4,0.0,abs(length(p-cp)-clickAge*0.5));

  // petals — 3 depth layers
  float petalSum=0.0;
  vec3 petalCol=vec3(0.0);
  for(int layer=0;layer<3;layer++){
    float fl=float(layer);
    float scale=6.0+fl*3.0;
    vec2 gp=p*scale;
    vec2 wind=vec2(cos(uTime*0.1+fl),sin(uTime*0.15+fl))*0.3;
    gp+=vec2(uTime*(0.4+fl*0.2), uTime*(0.15+fl*0.05))+wind;
    vec2 toM=gp/scale-m;
    float vd=length(toM), vstr=exp(-vd*2.5)*1.5;
    float vc=cos(vstr), vs=sin(vstr);
    gp=mat2(vc,-vs,vs,vc)*(gp-m*scale)+m*scale;
    vec2 toG=gp/scale-cp;
    gp+=normalize(toG+vec2(0.001))*gust*8.0;
    vec2 gi=floor(gp), gf=fract(gp)-0.5;
    vec2 jit=(hash2(gi+fl*17.0)-0.5)*0.6;
    float rot=hash(gi+fl*23.0)*6.28+uTime*(hash(gi)*2.0-1.0);
    float sz=0.18+0.12*hash(gi+fl*5.0);
    float pet=petal(gf-jit, rot, sz);
    vec3 pc=mix(vec3(1.0,0.75,0.85), vec3(1.0,0.6,0.75), hash(gi+fl));
    pc=mix(pc, vec3(1.0,0.92,0.95), 0.3);
    float depth=1.0-fl*0.25;
    petalCol+=pc*pet*depth*(0.6+0.4*hash(gi+fl*3.0));
    petalSum+=pet*depth;
  }
  col=mix(col, petalCol/max(petalSum,0.001), clamp(petalSum,0.0,1.0));

  // cursor glow + gust flash
  col+=vec3(1.0,0.85,0.9)*exp(-md*5.0)*0.15;
  col+=vec3(1.0,0.95,0.95)*gust*0.3;

  gl_FragColor=vec4(col,1.0);
}
`;

// Boot
(function(){
  const canvas = document.getElementById('blossom-canvas');
  if(!canvas) return;
  const runner = ShaderRunner.attach(canvas, window.FRAG_BLOSSOM);
  if(runner) runner.start();
})();
