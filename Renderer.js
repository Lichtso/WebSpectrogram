const shaderPrograms = {};
export let gl;

export function initRenderer(canvas) {
    gl = canvas.getContext('webgl');
    const vertexShaderCode = `
    uniform mat4 transform;
    attribute vec2 vPosition;
    varying vec2 fTexcoord;
    void main() {
        gl_Position = transform*vec4(vPosition, 0.0, 1.0);
        fTexcoord = (vPosition+vec2(1.0))*0.5;
    }`;
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderCode);
    gl.compileShader(vertexShader);
    const colorSchemeCodes = {
        'Magnitude': 'gl_FragColor.rgb = vec3(correction(length(complex)));',
        'Polar': 'gl_FragColor.rgb = hsl2rgb(vec3(atan(complex.y, complex.x), 1.0, correction(length(complex))));',
        'Real': 'gl_FragColor.rgb = vec3(correction(complex.r));',
        'Imaginary': 'gl_FragColor.rgb = vec3(correction(complex.g));',
        'Complex': 'gl_FragColor.rg = vec2(correction(complex.r), correction(complex.g));'
    };
    for(const colorSchemeName in colorSchemeCodes) {
        const fragmentShaderCode = `
        precision mediump float;
        uniform sampler2D real, imaginary;
        uniform float DisplayFactor, DisplayGamma;
        varying vec2 fTexcoord;
        float correction(float value) {
            return pow(value*DisplayFactor, DisplayGamma);
        }
        float hue2rgb(float f1, float f2, float hue) {
            if(hue < 0.0)
                hue += 1.0;
            else if(hue > 1.0)
                hue -= 1.0;
            float result;
            if((6.0 * hue) < 1.0)
                result = f1 + (f2 - f1) * 6.0 * hue;
            else if((2.0 * hue) < 1.0)
                result = f2;
            else if((3.0 * hue) < 2.0)
                result = f1 + (f2 - f1) * ((2.0 / 3.0) - hue) * 6.0;
            else
                result = f1;
            return result;
        }
        vec3 hsl2rgb(vec3 hsl) {
            vec3 rgb;
            if(hsl.y == 0.0) {
                rgb = vec3(hsl.z);
            } else {
                float f2;
                if(hsl.z < 0.5)
                    f2 = hsl.z * (1.0 + hsl.y);
                else
                    f2 = hsl.z + hsl.y - hsl.y * hsl.z;
                float f1 = 2.0 * hsl.z - f2;
                rgb.r = hue2rgb(f1, f2, hsl.x + (1.0/3.0));
                rgb.g = hue2rgb(f1, f2, hsl.x);
                rgb.b = hue2rgb(f1, f2, hsl.x - (1.0/3.0));
            }
            return rgb;
        }
        void main() {
            vec2 complex = vec2(texture2D(real, fTexcoord).r, texture2D(imaginary, fTexcoord).r);
            ${colorSchemeCodes[colorSchemeName]}
            gl_FragColor.a = 1.0;
        }`;
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentShaderCode);
        gl.compileShader(fragmentShader);
        const shaderProgram = gl.createProgram();
        gl.attachShader(shaderProgram, vertexShader);
        gl.attachShader(shaderProgram, fragmentShader);
        gl.linkProgram(shaderProgram);
        gl.useProgram(shaderProgram);
        gl.uniform1i(gl.getUniformLocation(shaderProgram, 'real'), 0);
        gl.uniform1i(gl.getUniformLocation(shaderProgram, 'imaginary'), 1);
        shaderPrograms[colorSchemeName] = shaderProgram;
        gl.deleteShader(fragmentShader);
    }
    gl.deleteShader(vertexShader);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
}

export function resizeCanvas() {
    gl.canvas.width = window.innerWidth;
    gl.canvas.height = window.innerHeight;
    gl.canvas.setAttribute('style', `width: ${gl.canvas.width}px; height: ${gl.canvas.height}px;`);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
}

export function setRendererParameter(id, value) {
    for(const name in shaderPrograms) {
        gl.useProgram(shaderPrograms[name]);
        gl.uniform1f(gl.getUniformLocation(shaderPrograms[name], id), value);
    }
}

export function renderFrame(ccwt, options) {
    if(!ccwt)
        return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(shaderPrograms[options.DisplayScheme]);
    let offset = (ccwt.playbackTime-ccwt.config.InputBegin)/ccwt.duration*ccwt.outputSampleCount,
        textureIndex = 0;
    for(let t = 0; t < ccwt.outputSampleCount; t += ccwt.windowSize) {
        const timeSize = Math.min(ccwt.windowSize, ccwt.outputSampleCount-t), freqSize = ccwt.config.DimensionsFrequency;
        gl.uniformMatrix4fv(gl.getUniformLocation(shaderPrograms[options.DisplayScheme], 'transform'), false, new Float32Array(
            (options.DisplayFormat == 'Horizontal') ? [
            timeSize/gl.canvas.width, 0, 0, 0,
            0, freqSize/gl.canvas.height, 0, 0,
            0, 0, 1, 0,
            (timeSize+2*(t-offset))/gl.canvas.width,
            (Math.min(gl.canvas.height-freqSize, 0)+2*window.scrollY)/gl.canvas.height,
            0, 1
        ] : [
            0, timeSize/gl.canvas.height, 0, 0,
            freqSize/gl.canvas.width, 0, 0, 0,
            0, 0, 1, 0,
            (-Math.min(gl.canvas.width-freqSize, 0)-2*window.scrollX)/gl.canvas.width,
            (timeSize+2*(t-offset))/gl.canvas.height,
            0, 1
        ]));
        for(let i = 0; i < 2; ++i) {
            gl.activeTexture(gl.TEXTURE0+i);
            gl.bindTexture(gl.TEXTURE_2D, ccwt.texture[textureIndex+i]);
        }
        textureIndex += 2;
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }
}
