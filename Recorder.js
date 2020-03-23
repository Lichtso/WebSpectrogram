let buffers, mediaStreamSource, processorNode;

export function startRecording(audioContext) {
    return navigator.mediaDevices.getUserMedia({'audio': true}).then((mediaStream) => {
        buffers = [];
        mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
        processorNode = audioContext.createScriptProcessor(16384, mediaStreamSource.channelCount, mediaStreamSource.channelCount);
        processorNode.onaudioprocess = (event) => {
            const channels = [];
            for(let c = 0; c < mediaStreamSource.channelCount; ++c)
                channels.push(new Float32Array(event.inputBuffer.getChannelData(c)));
            buffers.push(channels);
        };
        mediaStreamSource.connect(processorNode);
        mediaStreamSource.connect(audioContext.destination);
        processorNode.connect(audioContext.destination);
        audioContext.resume();
    });
};

export function stopRecording(audioContext) {
    mediaStreamSource.mediaStream.getAudioTracks()[0].stop();
    mediaStreamSource.disconnect();
    processorNode.disconnect();
    const result = audioContext.createBuffer(mediaStreamSource.channelCount, processorNode.bufferSize*buffers.length, audioContext.sampleRate);
    for(let channelIndex = 0; channelIndex < mediaStreamSource.channelCount; ++channelIndex) {
        const destination = result.getChannelData(channelIndex);
        for(let bufferIndex = 0; bufferIndex < buffers.length; ++bufferIndex) {
            const source = buffers[bufferIndex][channelIndex];
            destination.set(source, processorNode.bufferSize*bufferIndex);
        }
    }
    return result;
};
