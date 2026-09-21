---
created: 2026-09-20T14:07:56 (UTC +08:00)
source: https://trac.ffmpeg.org/wiki/Hardware/AMF
---

# Hardware/AMF – FFmpeg

[View WikiStart](https://trac.ffmpeg.org/wiki)[View Hardware](https://trac.ffmpeg.org/wiki/Hardware)/[View Hardware/AMF](https://trac.ffmpeg.org/wiki/Hardware/AMF)

- ![Up-vote](https://trac.ffmpeg.org/chrome/vote/aupgray.png)+0![Down-vote](https://trac.ffmpeg.org/chrome/vote/adowngray.png)
- [Up](https://trac.ffmpeg.org/wiki/Hardware)
- [Start Page](https://trac.ffmpeg.org/wiki/WikiStart)
- [Index](https://trac.ffmpeg.org/wiki/TitleIndex)
- [History](https://trac.ffmpeg.org/wiki/Hardware/AMF?action=history)

1. [1 Introduction](https://trac.ffmpeg.org/wiki/Hardware/AMF#a1Introduction)
2. [2 Hardware Decode](https://trac.ffmpeg.org/wiki/Hardware/AMF#a2HardwareDecode)
  1. [2.1 Hardware decoding via DX9](https://trac.ffmpeg.org/wiki/Hardware/AMF#a2.1HardwaredecodingviaDX9)
  2. [2.2 Hardware decoding via DX11](https://trac.ffmpeg.org/wiki/Hardware/AMF#a2.2HardwaredecodingviaDX11)
  3. [2.3 Hardware decoding via AMF](https://trac.ffmpeg.org/wiki/Hardware/AMF#a2.3HardwaredecodingviaAMF)
3. [3 Hardware Encode](https://trac.ffmpeg.org/wiki/Hardware/AMF#a3HardwareEncode)
4. [4 Transcode](https://trac.ffmpeg.org/wiki/Hardware/AMF#a4Transcode)
  1. [4.1 Hardware Decode and Hardware Encode](https://trac.ffmpeg.org/wiki/Hardware/AMF#a4.1HardwareDecodeandHardwareEncode)
  2. [4.2 Native AMF Hardware Pipeline](https://trac.ffmpeg.org/wiki/Hardware/AMF#a4.2NativeAMFHardwarePipeline)
    1. [Smart Access Video](https://trac.ffmpeg.org/wiki/Hardware/AMF#SmartAccessVideo)
  3. [4.3 Software Decode and Hardware Encode](https://trac.ffmpeg.org/wiki/Hardware/AMF#a4.3SoftwareDecodeandHardwareEncode)
  4. [4.4 Transcode with Scaling](https://trac.ffmpeg.org/wiki/Hardware/AMF#a4.4TranscodewithScaling)
5. [5 Filters](https://trac.ffmpeg.org/wiki/Hardware/AMF#a5Filters)
  1. [5.1 Screen Capture (vsrc_amf)](https://trac.ffmpeg.org/wiki/Hardware/AMF#a5.1ScreenCapturevsrc_amf)
    1. [Capture Modes](https://trac.ffmpeg.org/wiki/Hardware/AMF#CaptureModes)
    2. [Frame Duplication](https://trac.ffmpeg.org/wiki/Hardware/AMF#FrameDuplication)
  2. [5.2 Video Processing (vpp_amf)](https://trac.ffmpeg.org/wiki/Hardware/AMF#a5.2VideoProcessingvpp_amf)
  3. [5.3 Super Resolution Upscaling (sr_amf)](https://trac.ffmpeg.org/wiki/Hardware/AMF#a5.3SuperResolutionUpscalingsr_amf)
6. [6. Benchmark Testing and Profiling](https://trac.ffmpeg.org/wiki/Hardware/AMF#a6.BenchmarkTestingandProfiling)

# 1 Introduction

The Advanced Media Framework (AMF) SDK provides developers with easy access to AMD GPUs for multimedia processing.

AMF is effectively supported by FFmpeg to significantly speed up video encoding, decoding, and transcoding via AMD GPUs.

The following user guide shows how to use the FFmpeg command line to efficiently use the AMD hardware acceleration for video decoding, encoding, transcoding and processing.

# 2 Hardware Decode

AMF supports hardware decoding via DirectX in FFmpeg. Currently AMF supports DX9 and DX11 in FFmpeg.

## 2.1 Hardware decoding via DX9

```
ffmpeg -hwaccel dxva2 -i input.mkv output.yuv
```

**Note:** Currently AMD hardware doesn’t support **AV1 elementary stream decoding via DX9**. So, this command line is not applicable for AV1 bitstream as input.

## 2.2 Hardware decoding via DX11

```
ffmpeg -hwaccel d3d11va -i input.mkv output.yuv
```

In the above command line, “input.mkv” is only an example. The AMD hardware accelerated decoder supports most widely used containers and video elementary stream types. The following table lists detailed information about the widely used containers and video elementary streams which the AMD hardware accelerated decoder supports.

Table 1: Containers and video elementary streams supported by the AMD hardware accelerated **decoder**

| Format | Filename Extension | H.264/AVC | H.265/HEVC | AV1 |
| --- | --- | --- | --- | --- |
| Matroska | .mkv | Y | Y | Y |
| MPEG-4 Part 14 (MP4) | .mp4 | Y | Y | Y |
| Audio Video Interleave (AVI) | .avi | Y | N | Y |
| Material Exchange Format (MXF) | .mxf | Y | n/a | n/a |
| MPEG transport stream (TS) | .ts | Y | Y | N |
| 3GPP (3GP) | .3gp | Y | n/a | n/a |
| Flash Video (FLV) | .flv | Y | n/a | n/a |
| WebM | .webm | n/a | n/a | Y |
| Advanced Systems Format (ASF) | .asf .wmv | Y | Y | Y |
| QuickTime File Format (QTFF) | .mov | Y | Y | n/a |

- 'Y': Hardware accelerated decoder supports this input

- 'N': Hardware accelerated decoder doesn’t support this input

- 'n/a': This input is not applicable in specification

## 2.3 Hardware decoding via AMF

FFmpeg also supports hardware decoding using the native AMF hardware acceleration path.

```
ffmpeg -hwaccel amf -i input.mp4 -c:v h264 output.yuv
```

For a fully hardware (AMF) transcoding pipeline, see section 4.2 (Native AMF Hardware Pipeline).

# 3 Hardware Encode

Currently AMF encoder supports H.264/AVC, H.265/HEVC, AV1 encoder. FFmpeg uses `_amf` as the postfix for the AMF encoder names. The command lines shown below may use `h264_amf`, and should be replaced by `hevc_amf` for H.265/HEVC encoder and `av1_amf` for AV1 encoder.

```
ffmpeg -s 1920x1080 -pix_fmt yuv420p -i input.yuv -c:v h264_amf output.mp4

ffmpeg -s 1920x1080 -pix_fmt yuv420p -i input.yuv -c:v hevc_amf output.mp4

ffmpeg -s 1920x1080 -pix_fmt yuv420p -i input.yuv -c:v av1_amf output.mp4
```

In the above command line, “output.mp4” is only an example. The AMD hardware accelerated encoder supports most widely used container and video elementary stream types. The following table lists the detail information about the widely used containers and video elementary streams which the AMD hardware accelerated encoder supports.

Table 2: Containers and video elementary streams supported by the AMD hardware accelerated **encoder**

| Format | Filename Extension | H.264/AVC | H.265/HEVC | AV1 |
| --- | --- | --- | --- | --- |
| Matroska | .mkv | Y | Y | Y |
| MPEG-4 Part 14 (MP4) | .mp4 | Y | Y | Y |
| Audio Video Interleave (AVI) | .avi | Y | Y | Y |
| Material Exchange Format (MXF) | .mxf | Y | n/a | n/a |
| MPEG transport stream (TS) | .ts | Y | Y | Y |
| 3GPP (3GP) | .3gp | Y | n/a | n/a |
| Flash Video (FLV) | .flv | Y | n/a | n/a |
| WebM | .webm | n/a | n/a | Y |
| Advanced Systems Format (ASF) | .asf .wmv | Y | Y | Y |
| QuickTime File Format (QTFF) | .mov | Y | Y | n/a |

- 'Y': Hardware accelerated encoder supports this output

- 'n/a': This output is not applicable in specification

# 4 Transcode

There are multiple methods for transcoding in FFmpeg, depending on whether decoding and encoding are performed in software or using hardware acceleration.

## 4.1 Hardware Decode and Hardware Encode

Use DX9 hardware decoder

```
ffmpeg -hwaccel dxva2 -hwaccel_output_format dxva2_vld -i input.mkv -c:v av1_amf output.mp4
```

**Note:** Currently AMD hardware doesn’t support **AV1 elementary stream decoding via DX9**. So, this command line is not applicable for AV1 bitstream as input.

Use DX11 hardware decoder

```
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i input.mkv -c:v hevc_amf output.mp4
```

The parameter `hwaccel_output_format` will specify the raw data (YUV) format after decoding.

To avoid raw data copy between GPU memory and system memory, use `-hwaccel_output_format dxva2_vld` when using DX9 and use `-hwaccel_output_format d3d11` when using DX11. This will improve transcoding speed greatly. **This is the best setting we recommend for transcoding.**

When **using AV1 as the source elementary stream type**, with hardware acceleration, additional support for hardware surfaces is required in the **transcoding case**. This is achieved by adding the `extra_hw_frames` parameter.

```
ffmpeg -hwaccel dxva2 -hwaccel_output_format dxva2_vld -extra_hw_frames 10 -i input_av1_source.mkv -c:v av1_amf output.mp4
```

```
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -extra_hw_frames 10 -i input_av1_source.mkv -c:v hevc_amf output.mp4
```

## 4.2 Native AMF Hardware Pipeline

FFmpeg also supports a native AMF hardware acceleration pipeline where both decoding and encoding are performed using AMF surfaces.

This mode does not rely on DXVA2 or D3D11 and enables a full zero-copy AMF → AMF pipeline. It is available on supported platforms, including Linux and Windows.

```
ffmpeg -hwaccel amf -hwaccel_output_format amf -i input.mkv -c:v hevc_amf output.mkv
```

`-hwaccel_output_format amf` has a practical effect only when the decoded frames are consumed by AMF-aware components (such as AMF filters or AMF encoders). When a software encoder is used, the frames are automatically downloaded to system memory and the hardware output format does not provide any benefit.

Notes:

- Decoded frames are kept as AMF hardware surfaces and passed directly to the AMF encoder.
- No GPU ↔ system memory copies are performed.
- Supported codecs depend on GPU generation and driver support.
- Not all AMD GPUs support AV1 hardware decoding.

### Smart Access Video

AMF supports Smart Access Video, which allows decoding and encoding workloads to be distributed across more than one VCN instance within a single AMF hardware pipeline.

This can be achieved, for example, by using an integrated GPU (APU) together with a discrete GPU, or on GPUs that provide multiple VCN instances.

When enabled in such configurations, this feature can improve transcoding performance by up to 30% on supported hardware.

Smart Access Video is supported on:

- AMD Ryzen 5000 series and newer APUs together with AMD Radeon RX 6000 series and newer GPUs
- AMD Radeon GPUs with support for multiple VCN instances

To enable Smart Access Video, the AMF hardware pipeline must be used for both input and output.

Example:

```
ffmpeg -hwaccel amf -hwaccel_output_format amf -i input.mp4 -c:v hevc_amf -smart_access_video 1 output.mp4
```

Notes:

- Smart Access Video is an AMF encoder option.
- The feature requires compatible CPU and GPU combinations.
- Performance gains depend on workload and hardware configuration.

## 4.3 Software Decode and Hardware Encode

Use the CPU to decode the input bitstream, and the GPU to encode the output stream.

```
ffmpeg -i input.mkv -c:v av1_amf output.mp4
```

The default software decoder corresponding to the elementary video stream will be used as the decoder.

## 4.4 Transcode with Scaling

Scaling is a very common operation in transcoding. It is done through video filter in FFmpeg.

**1. Hardware decode and hardware encode with scaling**

```
ffmpeg -hwaccel dxva2 -i input.mkv  -vf scale=1280x720 -c:v h264_amf output.mp4

ffmpeg -hwaccel d3d11va -i input.mkv  -vf scale=1280x720 -c:v h264_amf output.mp4
```

If filter parameters are used in transcoding, users can’t set `hwaccel_output_format` parameters. In fact, the filter processing is finished in the CPU in the above example.

**Note:** Currently AMD hardware doesn’t support **AV1 elementary stream decoding via DX9**. So, this command line with parameter “-hwaccel dxva2” is not applicable for AV1 bitstream as input.

**2. Software decode and hardware encode with scaling**

In the following command line, both decoding and scaling are done via the CPU, and encoding is done via the GPU.

```
ffmpeg -i input.mkv -vf scale=1280x720 -c:v h264_amf output.mp4
```

# 5 Filters

FFmpeg provides AMF-based video filters that operate on AMF hardware frames and integrate into the AMF hardware pipeline.

## 5.1 Screen Capture (vsrc_amf)

FFmpeg supports screen capture using the AMF hardware pipeline via the `vsrc_amf` video source filter. The captured frames are produced as AMF hardware frames and can be passed directly to AMF encoders without copying through system memory.

Example:

```
ffmpeg -y -filter_complex "vsrc_amf=framerate=120:capture_mode=keep_framerate" -c:v hevc_amf output_grab.mp4
```

Notes:

- The `vsrc_amf` filter produces AMF hardware frames.
- To avoid frame drops, ensure that the AMF hardware frames pool is sufficiently large.
- If the hardware frames pool is insufficient, increase the `extra_hw_frames` parameter in `filter_complex`.

### Capture Modes

The `vsrc_amf` filter supports multiple screen capture modes that control how frames are acquired and timed.

- keep_framerate (default)

This is the default and recommended mode. The filter internally paces frame delivery and attempts to maintain the requested framerate specified via the `framerate` option.

For most users, this mode provides the expected FFmpeg behavior and is suitable for typical screen recording use cases.

- wait_for_present

In this mode, the filter waits for screen presentation events (e.g. DWM or full-screen application present calls). The user-specified `framerate` value is ignored.

The effective output framerate depends on the presentation timing of the captured content. This mode follows the behavior of the underlying AMF screen capture API.

- get_current

This mode immediately returns the most recently visible surface without waiting for presentation events or enforcing timing.

No internal frame pacing is performed. It is assumed that the caller handles timing and synchronization externally.

This mode is primarily intended for advanced or library use cases where minimal latency and direct access to the current visible surface are required, and is generally less suitable for typical FFmpeg command-line usage.

### Frame Duplication

The FFmpeg AMF screen capture component may duplicate frames ('duplicate_output' parameter) to maintain a stable output stream when the screen content does not change or when presentation events are irregular.

This behavior is enabled by default in FFmpeg and is suitable for typical screen recording use cases, ensuring smooth output timing.

By design, the AMF screen capture component itself provides only a single frame representing the currently visible screen. Frame duplication is therefore required on the FFmpeg side to support pipelining and continuous frame delivery in the FFmpeg application.

For low-latency capture and encode scenarios, especially when FFmpeg is used as a library and the caller performs its own timing and synchronization, frame duplication can be disabled to reduce latency.

Disabling frame duplication is an advanced use case and may result in variable frame delivery if the presentation timing is irregular.

## 5.2 Video Processing (vpp_amf)

`vpp_amf` is an AMF-based video processing filter that performs scaling (resize) and color-related conversions, including colorspace, transfer characteristics, and color primaries.

The output width and height options work in the same way as for the `scale` filter.

Options (high level):

- `w`, `h`: output dimensions (same expressions as `scale`)
- `scale_type`: scaling algorithm (`bilinear` (default), `bicubic`)
- `format`: output pixel format (defaults to input)
- `force_original_aspect_ratio`, `force_divisible_by`, `reset_sar`: same behavior as the corresponding `scale` filter options

Example:

```
ffmpeg -hwaccel amf -hwaccel_output_format amf -i input.mp4 -vf "vpp_amf=1280:720:format=yuv420p" -c:v hevc_amf output.mp4
```

## 5.3 Super Resolution Upscaling (sr_amf)

`sr_amf` is an AMF-based upscaling (size increasing) video filter. It provides both traditional scaling and AMF Super Resolution algorithms for higher quality upscaling on supported AMD hardware. The output width/height options work the same way as the `scale` filter.

Options (high level):

- `w`, `h`: output dimensions (same expressions as `scale`)
- `algorithm`: scaling algorithm (`bilinear`, `bicubic`, `point`, `sr1-0` (default), `sr1-1`)
- `sharpness`: sharpening amount, range [0.0, 2.0]
- `format`: output pixel format (defaults to input)
- `keep-ratio`: keep aspect ratio when output aspect differs
- `fill`: fill the area outside the region of interest

Examples:

- Scale input to 720p, keeping aspect ratio and ensuring yuv420p output:

```
ffmpeg -hwaccel amf -hwaccel_output_format amf -i input.mp4 -vf "sr_amf=-2:720:format=yuv420p" -c:v hevc_amf output.mp4
```

- Upscale to 4K using Super Resolution algorithm SR1.1:

```
ffmpeg -hwaccel amf -hwaccel_output_format amf -i input.mp4 -vf "sr_amf=4096:2160:algorithm=sr1-1" -c:v hevc_amf output.mp4
```

# 6. Benchmark Testing and Profiling

When the encoder and decoder work on a specific device, their performances are determined by several factors, such as CPU performance, GPU performance, memory performance, and disk read/write speed. The following command lines are used for benchmark testing. By avoiding writing raw data to the disk, users can test the performance of encoders and decoders more accurately.

To run the decoding benchmark, use the following command:

```
ffmpeg -hwaccel dxva2 -hwaccel_output_format dxva2_vld -i input.mkv -f null - -benchmark

ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i input.mkv -f null - -benchmark
```

To run the encoding benchmark, use the following command:

```
ffmpeg -s 1920x1080 -pix_fmt yuv420p -i input.yuv -c:v av1_amf output.mp4 -benchmark
```

To run the transcoding benchmark, use the following command:

```
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i input.mkv -c:v hevc_amf output.mp4 -benchmark
```

[Version 2 by ArazIusubov: Updated the AMF documentation to reflect recent enhancements and clarifications](https://trac.ffmpeg.org/wiki/Hardware/AMF?action=diff&version=2) [See timeline at Jan 23, 2026, 4:28:41 PM](https://trac.ffmpeg.org/timeline?from=2026-01-23T16%3A28%3A41Z&precision=second)

- Tags
- [amf](https://trac.ffmpeg.org/tags/amf)
- [hwaccel](https://trac.ffmpeg.org/tags/hwaccel)

**Note:** See [TracWiki](https://trac.ffmpeg.org/wiki/TracWiki) for help on using the wiki.

### Download in other formats:

- [Plain Text](https://trac.ffmpeg.org/wiki/Hardware/AMF?format=txt)