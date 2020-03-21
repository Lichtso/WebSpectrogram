let module, wasm;
const path = 'https://github.com/Lichtso/complex_continuous_wavelet_transform/releases/download/v0.1.0/ccwt.wasm',
      imports = {};
imports.wbg = {};
imports.wbg.__wbindgen_throw = function(arg0, arg1) {
    throw new Error(getStringFromWasm(arg0, arg1));
};

export const loadedWASM = ((typeof process === 'undefined')
? fetch(path).then(response => response.arrayBuffer())
: new Promise((resolve, reject) => {
    Promise.all([import('url'), import('path'), import('fs')]).then(([url, path, fs]) => {
        const __filename = url.fileURLToPath(import.meta.url),
              __dirname = path.dirname(__filename);
        fs.readFile(path.join(__dirname, path), undefined, (err, data) => {
            err ? reject(err) : resolve(data);
        });
    });
}))
.then(arrayBuffer => WebAssembly.instantiate(arrayBuffer, imports))
.then(result => {
    module = result.module;
    wasm = result.instance.exports;
});

let cachedUint8Memory = null;
function getUint8Memory() {
    if(cachedUint8Memory === null || cachedUint8Memory.buffer !== wasm.memory.buffer)
        cachedUint8Memory = new Uint8Array(wasm.memory.buffer);
    return cachedUint8Memory;
}

let cachedFloat32Memory = null;
function getFloat32Memory() {
    if(cachedFloat32Memory === null || cachedFloat32Memory.buffer !== wasm.memory.buffer)
        cachedFloat32Memory = new Float32Array(wasm.memory.buffer);
    return cachedFloat32Memory;
}

const cachedTextDecoder = new TextDecoder('utf-8');
function getStringFromWasm(ptr, len) {
    return cachedTextDecoder.decode(getUint8Memory().subarray(ptr, ptr+len));
}

const bytesPerElement = 4; // Float32



function progressCallbackDelay(message, value) {
    this.progressCallback(message, value);
    return new Promise((resolve, reject) => {
        setTimeout(resolve, 1);
    });
}

export function getIndexOfFrequency(ccwt, frequency) {
    if(ccwt.config.FrequencyBandBasis > 0.0)
        frequency = Math.log(frequency)/Math.log(ccwt.config.FrequencyBandBasis);
    return (frequency-ccwt.minFreq)/ccwt.freqBandFactor;
}

export function getFrequencyAtIndex(ccwt, index) {
    let frequency = ccwt.minFreq+index*ccwt.freqBandFactor,
        derivative = ccwt.freqBandFactor;
    if(ccwt.config.FrequencyBandBasis > 0.0) {
        frequency = Math.pow(ccwt.config.FrequencyBandBasis, frequency);
        derivative *= Math.log(ccwt.config.FrequencyBandBasis)*frequency;
    }
    return [frequency, derivative];
}

export function doCCWT(config, gl, audioBuffer, progressCallback) {
    const ccwt = {};
    ccwt.config = config;
    ccwt.audioBuffer = audioBuffer;
    ccwt.progressCallback = progressCallback;
    ccwt.config.InputBegin = Math.max(0, ccwt.config.InputBegin);
    ccwt.config.InputEnd = Math.min(ccwt.audioBuffer.duration, ccwt.config.InputEnd);
    ccwt.duration = ccwt.config.InputEnd-ccwt.config.InputBegin;
    ccwt.inputSampleOffset = Math.floor(ccwt.config.InputBegin*ccwt.audioBuffer.sampleRate);
    ccwt.inputSampleCount = Math.min(Math.ceil(ccwt.audioBuffer.sampleRate*ccwt.duration), ccwt.audioBuffer.length-ccwt.inputSampleOffset-1);
    ccwt.outputSampleCount = Math.floor(ccwt.config.DimensionsTime*ccwt.duration);
    ccwt.inputPadding = Math.floor(ccwt.config.DimensionsPadding*0.001*ccwt.audioBuffer.sampleRate);
    ccwt.windowSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    ccwt.windowCount = Math.ceil(ccwt.outputSampleCount/ccwt.windowSize);
    ccwt.minFreq = ccwt.config.FrequencyBandMin*ccwt.duration,
    ccwt.maxFreq = ccwt.config.FrequencyBandMax*ccwt.duration;
    if(ccwt.config.FrequencyBandBasis) {
        ccwt.minFreq = Math.log(ccwt.minFreq)/Math.log(ccwt.config.FrequencyBandBasis);
        ccwt.maxFreq = Math.log(ccwt.maxFreq)/Math.log(ccwt.config.FrequencyBandBasis);
    }
    ccwt.freqBandFactor = (ccwt.maxFreq-ccwt.minFreq)/ccwt.config.DimensionsFrequency;
    const ext = gl.getExtension('OES_texture_float');
    ccwt.spectrogramTextures = [];
    for(let i = 0; i < 2; ++i) {
        ccwt.spectrogramTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, ccwt.spectrogramTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    ccwt.texture = [];
    ccwt.spectrogram = [];
    for(let i = 0; i < 2; ++i)
        ccwt.spectrogram[i] = new Float32Array(ccwt.outputSampleCount*ccwt.config.DimensionsFrequency);
    ccwt.promise = loadedWASM.then(progressCallbackDelay.bind(ccwt, 'Extracting Channel')).then(() => {
        ccwt.signal = ccwt.audioBuffer.getChannelData(ccwt.config.InputChannel);
    }).then(progressCallbackDelay.bind(ccwt, 'Transforming Signal')).then(() => {
        const inputByteLength = ccwt.inputSampleCount*bytesPerElement,
              inputPtr = wasm.__wbindgen_malloc(inputByteLength);
        getFloat32Memory().set(ccwt.signal.subarray(ccwt.inputSampleOffset, ccwt.inputSampleOffset+ccwt.inputSampleCount), inputPtr/bytesPerElement);
        ccwt.wasmPtr = wasm.new_ccwt(inputPtr, ccwt.inputSampleCount, ccwt.inputPadding, ccwt.outputSampleCount);
        wasm.__wbindgen_free(inputPtr, inputByteLength);
        ccwt.outputPtr = wasm.__wbindgen_malloc(ccwt.outputSampleCount*2*bytesPerElement);
        delete ccwt.signal;
    });
    for(let freqIndex = 0; freqIndex < ccwt.config.DimensionsFrequency; ++freqIndex)
        ccwt.promise = ccwt.promise.then(progressCallbackDelay.bind(ccwt, 'Calculating Spectrogram', freqIndex/ccwt.config.DimensionsFrequency)).then(() => {
            const [frequency, derivative] = getFrequencyAtIndex(ccwt, freqIndex);
            wasm.get_transformed_frequency(ccwt.wasmPtr, ccwt.outputPtr, ccwt.outputSampleCount*2, frequency, derivative);
            const data = getFloat32Memory().subarray(ccwt.outputPtr/bytesPerElement, ccwt.outputPtr/bytesPerElement+ccwt.outputSampleCount*2);
            for(let i = 0; i < ccwt.outputSampleCount; ++i) {
                const outIndex = freqIndex*ccwt.outputSampleCount+i, inIndex = 2*i;
                ccwt.spectrogram[0][outIndex] = data[inIndex  ];
                ccwt.spectrogram[1][outIndex] = data[inIndex+1];
            }
        });
    ccwt.promise = ccwt.promise.then(progressCallbackDelay.bind(ccwt, 'Uploading Spectrogram')).then(() => {
        // gl.pixelStorei(gl.UNPACK_ROW_LENGTH, ccwt.outputSampleCount);
        let textureIndex = 0;
        for(let t = 0; t < ccwt.outputSampleCount; t += ccwt.windowSize) {
            const timeSize = Math.min(ccwt.windowSize, ccwt.outputSampleCount-t), freqSize = ccwt.config.DimensionsFrequency,
                  aux = new Float32Array(timeSize*freqSize);
            // gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
            for(let i = 0; i < 2; ++i) {
                const texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                for(let y = 0; y < freqSize; ++y)
                    for(let x = 0; x < timeSize; ++x)
                        aux[y*timeSize+x] = ccwt.spectrogram[i][y*ccwt.outputSampleCount+x+t];
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, timeSize, freqSize, 0, gl.LUMINANCE, gl.FLOAT, aux);
                ccwt.texture[textureIndex++] = texture;
            }
        }
        wasm.__wbindgen_free(ccwt.outputPtr, ccwt.outputSampleCount*2*bytesPerElement);
        wasm.__wbg_ccwt_free(ccwt.wasmPtr);
        // gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        // gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        delete ccwt.wasmPtr;
    });
    return ccwt;
}
