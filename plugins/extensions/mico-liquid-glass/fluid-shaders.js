/* 独立 GLSL 实现：值噪声域扭曲、圆角距离场、薄透镜采样和色散。
 * 数学参考与项目出处见 WEBGL-NOTES.md；没有复制外部 shader 文本。 */
(() => {
    const vertex = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() { v_uv = a_position * .5 + .5; gl_Position = vec4(a_position, 0., 1.); }
`;
    const fluid = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_colors[4];
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.19, 311.73))) * 43758.231); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1.,0.)), f.x), mix(hash(i + vec2(0.,1.)), hash(i + 1.), f.x), f.y);
}
float field(vec2 p) { return noise(p) * .57 + noise(p * 2.01 + 7.3) * .29 + noise(p * 4.03 + 13.7) * .14; }
void main() {
    vec2 p = v_uv; p.x *= u_resolution.x / max(u_resolution.y, 1.);
    float t = u_time * .12;
    vec2 warp = vec2(field(p * 1.8 + vec2(t, -t * .7)), field(p * 1.7 + vec2(-t * .6, t) + 21.3));
    p += (warp - .5) * .78;
    float aspect = u_resolution.x / max(u_resolution.y, 1.);
    vec2 a = vec2(.2 * aspect + .20 * sin(t * .7), .75 + .20 * cos(t * .6));
    vec2 b = vec2(.85 * aspect + .22 * cos(t * .65), .5 + .26 * sin(t * .5));
    vec2 c = vec2(.46 * aspect + .24 * sin(t * .48 + 2.), .12 + .21 * cos(t * .72));
    vec2 d = vec2(.6 * aspect + .21 * cos(t * .43 + 1.), .86 + .19 * sin(t * .59));
    vec4 weights = exp(-vec4(dot(p-a,p-a), dot(p-b,p-b), dot(p-c,p-c), dot(p-d,p-d)) * 2.6);
    weights = max(weights, vec4(.012)); weights /= dot(weights, vec4(1.));
    vec3 color = u_colors[0] * weights.x + u_colors[1] * weights.y + u_colors[2] * weights.z + u_colors[3] * weights.w;
    float ribbon = field(p * 2.2 + warp * 1.7 + vec2(t * .5, -t * .3));
    color *= .81 + ribbon * .27;
    float luma = dot(color, vec3(.2126,.7152,.0722));
    color = mix(vec3(luma), color, 1.22);
    color *= .84 + .16 * smoothstep(0., .8, v_uv.y);
    color += (hash(gl_FragCoord.xy) - .5) * .013;
    gl_FragColor = vec4(clamp(color, .008, .96), 1.);
}
`;
    const copy = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_scene;
void main() { gl_FragColor = texture2D(u_scene, v_uv); }
`;
    const image = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_cover;
uniform vec2 u_view;
uniform vec4 u_rect;
uniform vec2 u_crop;
uniform float u_radius;
uniform float u_opacity;
void main() {
    vec2 p = vec2(v_uv.x * u_view.x, (1.-v_uv.y) * u_view.y);
    vec2 q = abs(p-u_rect.xy) - u_rect.zw*.5 + u_radius;
    float sd = length(max(q,0.)) + min(max(q.x,q.y),0.) - u_radius;
    if (sd > 1.) discard;
    vec2 local = (p-u_rect.xy) / u_rect.zw;
    vec2 uv = vec2(local.x,-local.y) * u_crop + .5;
    vec4 color = texture2D(u_cover, uv);
    gl_FragColor = vec4(color.rgb, color.a * u_opacity * (1.-smoothstep(-.5,.75,sd)));
}
`;
    const glass = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_view;
uniform vec4 u_rect;
uniform float u_radius;
uniform vec4 u_joinRect;
uniform float u_joinRadius;
uniform float u_joinAmount;
uniform vec2 u_pointer;
uniform float u_pointerActive;
uniform float u_strength;
uniform float u_opacity;
uniform float u_frost;
float rounded(vec2 p, vec4 rect, float radius) {
    vec2 q = abs(p - rect.xy) - rect.zw * .5 + radius;
    return length(max(q, 0.)) + min(max(q.x,q.y),0.) - radius;
}
float merged(vec2 p) {
    float a = rounded(p, u_rect, u_radius);
    if (u_joinAmount <= .01) return a;
    float b = rounded(p, u_joinRect, u_joinRadius);
    float h = max(u_joinAmount - abs(a-b), 0.) / u_joinAmount;
    return min(a,b) - h*h*u_joinAmount*.25;
}
vec2 uvAt(vec2 p) { return clamp(vec2(p.x / u_view.x, 1. - p.y / u_view.y), vec2(.001), vec2(.999)); }
vec3 smoothScene(vec2 p, float r) {
    vec2 uv = uvAt(p), tap = vec2(r) / u_view;
    vec3 result = texture2D(u_scene,uv).rgb * .28;
    result += texture2D(u_scene, uv + vec2(tap.x, 0.)).rgb * .18;
    result += texture2D(u_scene, uv - vec2(tap.x, 0.)).rgb * .18;
    result += texture2D(u_scene, uv + vec2(0.,tap.y)).rgb * .18;
    result += texture2D(u_scene, uv - vec2(0.,tap.y)).rgb * .18;
    return result;
}
void main() {
    vec2 p = vec2(v_uv.x * u_view.x, (1.-v_uv.y) * u_view.y);
    float sd = merged(p);
    if (sd > 1.2) discard;
    float coverage = 1. - smoothstep(-.65, .85, sd);
    vec2 normal = normalize(vec2(merged(p + vec2(.65,0.)) - merged(p - vec2(.65,0.)), merged(p + vec2(0.,.65)) - merged(p - vec2(0.,.65))) + vec2(.0001));
    float band = min(22., max(5., min(u_rect.z,u_rect.w) * .24));
    float edge = clamp(1. + min(sd, 0.) / band, 0., 1.);
    // The dome's slope approaches the rim continuously. Snell refraction gives
    // a bounded ray displacement while leaving the flat centre undistorted.
    float slope = edge / sqrt(max(.10, 1. - edge * edge));
    vec3 surfaceNormal = normalize(vec3(normal * slope, 1.));
    float thickness = min(24., max(7., min(u_rect.z,u_rect.w) * .40));
    vec3 rayGreen = refract(vec3(0.,0.,-1.), surfaceNormal, 1. / 1.45);
    vec3 rayRed = refract(vec3(0.,0.,-1.), surfaceNormal, 1. / 1.43);
    vec3 rayBlue = refract(vec3(0.,0.,-1.), surfaceNormal, 1. / 1.48);
    vec2 offset = rayGreen.xy / max(abs(rayGreen.z), .2) * thickness * u_strength;
    vec2 samplePoint = p + offset;
    vec3 refracted = smoothScene(samplePoint, (2. + edge * 4.) * u_frost);
    vec2 redOffset = rayRed.xy / max(abs(rayRed.z), .2) * thickness * u_strength;
    vec2 blueOffset = rayBlue.xy / max(abs(rayBlue.z), .2) * thickness * u_strength;
    refracted.r = mix(refracted.r, texture2D(u_scene,uvAt(p + redOffset)).r, .70);
    refracted.b = mix(refracted.b, texture2D(u_scene,uvAt(p + blueOffset)).b, .70);
    float luma = dot(refracted, vec3(.2126,.7152,.0722));
    refracted = mix(vec3(luma), refracted, 1.35);
    vec2 lightDirection = normalize(vec2(-.65,-.76));
    float rim = pow(max(0., dot(normal,lightDirection)), 5.) * exp(-abs(sd + .7) * 1.5);
    float opposing = pow(max(0.,dot(normal,-lightDirection)),4.) * exp(-abs(sd + 1.5) * .8);
    float pointerGlow = exp(-length(p-u_pointer)/max(30.,min(u_rect.z,u_rect.w)*.85)) * u_pointerActive;
    float thinEdge = exp(-abs(sd + .6) * 2.1);
    // Schlick reflectance is weak head-on and rises with the curved edge.
    float fresnel = .034 + .966 * pow(1. - surfaceNormal.z, 5.);
    vec3 glassColor = mix(refracted, vec3(.88,.94,1.), fresnel * .18);
    glassColor += vec3(.016 + rim*.46 + opposing*.085 + thinEdge*.045 + pointerGlow*(.025+edge*.18));
    glassColor *= 1. - .05 * edge;
    gl_FragColor = vec4(clamp(glassColor,0.,1.), coverage * u_opacity);
}
`;
    globalThis.MicoFluidShaders = Object.freeze({ vertex, fluid, copy, image, glass });
})();
