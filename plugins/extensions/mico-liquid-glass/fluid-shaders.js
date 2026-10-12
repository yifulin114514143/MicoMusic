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
uniform sampler2D u_coverField;
uniform float u_coverMix;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.19, 311.73))) * 43758.231); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1.,0.)), f.x), mix(hash(i + vec2(0.,1.)), hash(i + 1.), f.x), f.y);
}
float field(vec2 p) { return noise(p) * .57 + noise(p * 2.01 + 7.3) * .29 + noise(p * 4.03 + 13.7) * .14; }
void main() {
    vec2 p = v_uv; p.x *= u_resolution.x / max(u_resolution.y, 1.);
    float t = u_time * .18;
    vec2 warp = vec2(field(p * 1.65 + vec2(t, -t * .72)), field(p * 1.5 + vec2(-t * .64, t) + 21.3));
    vec2 fold = vec2(field(p * 2. + warp * 1.45 + vec2(-t * .38,t * .6)), field(p * 1.8 + warp * 1.6 + vec2(t * .5,t * .31) + 8.7));
    p += (warp - .5) * .78 + (fold - .5) * .42;
    float aspect = u_resolution.x / max(u_resolution.y, 1.);
    vec2 a = vec2((.22 + .23 * sin(t * .7)) * aspect, .68 + .25 * cos(t * .6));
    vec2 b = vec2((.74 + .27 * cos(t * .55)) * aspect, .4 + .3 * sin(t * .5));
    vec2 c = vec2((.46 + .23 * sin(t * .48 + 2.)) * aspect, .14 + .26 * cos(t * .72));
    vec2 d = vec2((.58 + .22 * cos(t * .43 + 1.)) * aspect, .83 + .24 * sin(t * .59));
    vec4 radii = vec4(3.8,3.2,4.1,3.4) + .45 * sin(vec4(t*.4,t*.5+1.,t*.3+2.,t*.45+3.));
    vec4 weights = exp(-vec4(dot(p-a,p-a), dot(p-b,p-b), dot(p-c,p-c), dot(p-d,p-d)) * radii);
    weights = max(weights, vec4(.012)); weights /= dot(weights, vec4(1.));
    vec3 color = u_colors[0] * weights.x + u_colors[1] * weights.y + u_colors[2] * weights.z + u_colors[3] * weights.w;
    // Preserve spatial colour from a small real cover texture. A broad disc
    // removes recognisable artwork, while its warped rotating UV field keeps
    // neighbouring colour regions flowing together instead of moving 4 blobs.
    if (u_coverMix > .001) {
        float angle = t * .36;
        mat2 rotation = mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
        vec2 uv = .5 + .44 * sin(rotation * ((v_uv-.5) * vec2(aspect,1.)) * 2.4 + warp*.8 + fold*.35);
        vec3 spatial = texture2D(u_coverField,uv).rgb * .2;
        spatial += texture2D(u_coverField,clamp(uv+vec2(.13,0.),.001,.999)).rgb * .1;
        spatial += texture2D(u_coverField,clamp(uv-vec2(.13,0.),.001,.999)).rgb * .1;
        spatial += texture2D(u_coverField,clamp(uv+vec2(0.,.13),.001,.999)).rgb * .1;
        spatial += texture2D(u_coverField,clamp(uv-vec2(0.,.13),.001,.999)).rgb * .1;
        spatial += texture2D(u_coverField,clamp(uv+vec2(.09,.09),.001,.999)).rgb * .1;
        spatial += texture2D(u_coverField,clamp(uv-vec2(.09,.09),.001,.999)).rgb * .1;
        spatial += texture2D(u_coverField,clamp(uv+vec2(-.09,.09),.001,.999)).rgb * .1;
        spatial += texture2D(u_coverField,clamp(uv+vec2(.09,-.09),.001,.999)).rgb * .1;
        color = mix(color, spatial, .38 * u_coverMix);
    }
    float ribbon = field(p * 2.2 + warp * 1.7 + vec2(t * .5, -t * .3));
    color *= .81 + ribbon * .27;
    float luma = dot(color, vec3(.2126,.7152,.0722));
    color = mix(vec3(luma), color, 1.22);
    color *= .84 + .16 * smoothstep(0., .8, v_uv.y);
    color += (hash(gl_FragCoord.xy) - .5) * .013;
    gl_FragColor = vec4(clamp(color, .008, .96), 1.);
}
`;
    // A fixed Gaussian disc keeps the fragment shader compatible with WebGL1.
    // The same sampler is used for all refracted RGB channels, so chromatic
    // separation never restores sharp cover details over regular menu glass.
    const disc = Array.from({ length: 12 }, (_, i) => {
        const radius = Math.sqrt((i + .5) / 12), angle = i * Math.PI * (3 - Math.sqrt(5));
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, weight: Math.exp(-2 * radius * radius) };
    });
    const totalWeight = disc.reduce((total, tap) => total + tap.weight, 0);
    const blurSamples = disc.map(tap => `result += texture2D(u_scene, uvAt(p + vec2(${tap.x.toFixed(6)},${tap.y.toFixed(6)}) * radius)).rgb * ${(tap.weight / totalWeight).toFixed(8)};`).join('\n');
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
uniform float u_regular;
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
    float radius = r;
    vec3 result = vec3(0.);
    if (radius < .5) result = texture2D(u_scene, uvAt(p)).rgb;
    else { ${blurSamples} }
    // Large text menus retain a stable dark regular material. Nearby colour
    // still passes through, but bright media cannot erase white labels.
    float luma = dot(result, vec3(.2126,.7152,.0722));
    vec3 regular = mix(result / (1. + 2.6 * luma), vec3(.055,.067,.085), .18);
    return mix(result, regular, u_regular);
}
void main() {
    vec2 p = vec2(v_uv.x * u_view.x, (1.-v_uv.y) * u_view.y);
    float sd = merged(p);
    if (sd > 1.2) {
        if (u_regular < .01 || sd > 26.) discard;
        float shadowDistance = max(merged(p - vec2(0.,6.)), 0.);
        float shadow = .22 * u_regular * exp(-shadowDistance * shadowDistance / 128.);
        gl_FragColor = vec4(.012,.017,.026, shadow * u_opacity);
        return;
    }
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
    float blurRadius = mix(1.2 + edge * 3., 20. + edge * 5., u_regular) * u_frost;
    vec3 refracted = smoothScene(samplePoint, blurRadius);
    vec2 redOffset = rayRed.xy / max(abs(rayRed.z), .2) * thickness * u_strength;
    vec2 blueOffset = rayBlue.xy / max(abs(rayBlue.z), .2) * thickness * u_strength;
    refracted.r = mix(refracted.r, smoothScene(p + redOffset, blurRadius).r, .45);
    refracted.b = mix(refracted.b, smoothScene(p + blueOffset, blurRadius).b, .45);
    float luma = dot(refracted, vec3(.2126,.7152,.0722));
    refracted = mix(vec3(luma), refracted, mix(1.18,1.06,u_regular));
    vec2 lightDirection = normalize(vec2(-.65,-.76));
    float rim = pow(max(0., dot(normal,lightDirection)), 5.) * exp(-abs(sd + .7) * 1.5);
    float opposing = pow(max(0.,dot(normal,-lightDirection)),4.) * exp(-abs(sd + 1.5) * .8);
    float pointerGlow = exp(-length(p-u_pointer)/max(30.,min(u_rect.z,u_rect.w)*.85)) * u_pointerActive;
    float thinEdge = exp(-abs(sd + .6) * 2.1);
    // Schlick reflectance is weak head-on and rises with the curved edge.
    float fresnel = .034 + .966 * pow(1. - surfaceNormal.z, 5.);
    vec3 glassColor = mix(refracted, vec3(.88,.94,1.), fresnel * .18);
    glassColor += vec3(.012 + rim*.25 + opposing*.055 + thinEdge*.032 + pointerGlow*(.02+edge*.12));
    glassColor *= 1. - .05 * edge;
    gl_FragColor = vec4(clamp(glassColor,0.,1.), coverage * u_opacity);
}
`;
    globalThis.MicoFluidShaders = Object.freeze({ vertex, fluid, copy, image, glass });
})();
