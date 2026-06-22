# Wan 2.1 Video Generation Templates

This collection features the latest Wan 2.1 model workflows for advanced video generation with enhanced camera control, inpainting, and video effects capabilities.

## 🎬 What is Wan 2.1?

Wan 2.1 is an advanced video generation model that builds upon the success of previous versions with significant improvements in:
- **Camera Movement Control**: Precise control over camera angles and motion
- **Video Quality**: Higher resolution and better temporal consistency  
- **Feature Diversity**: Support for various video effects and manipulations
- **Inference Speed**: Optimized for both 1.3B and 14B parameter variants

## ✨ New Features in Wan 2.1

### 🎥 Enhanced Camera Control
- **Precise Motion**: Fine-grained control over camera movement
- **Multi-angle Generation**: Generate videos from different perspectives
- **Smooth Transitions**: Better temporal consistency in camera motion

### 🖼️ Advanced Video Effects
- **FLF2V**: First-Last-Frame to Video generation
- **Fun Control**: Interactive control over video generation
- **Inpainting**: Video inpainting and object removal

### ⚡ Dual Model Support
- **1.3B Model**: Faster inference for quick prototyping
- **14B Model**: Higher quality for production use

## 📂 Available Templates

### 🎥 Camera Control Templates

#### **`video_wan2.1_fun_camera_v1.1_1.3B.json`**
- **Model**: Wan 2.1 Fun Camera (1.3B parameters)
- **Description**: Interactive camera control for video generation
- **Features**: Real-time camera movement, angle adjustment
- **Use Case**: Quick video prototyping with camera effects

#### **`video_wan2.1_fun_camera_v1.1_14B.json`**  
- **Model**: Wan 2.1 Fun Camera (14B parameters)
- **Description**: High-quality camera control workflow
- **Features**: Professional-grade camera movement, cinematic effects
- **Use Case**: Production-quality video with complex camera work

### 🎞️ Video Effects Templates

#### **`wan2.1_flf2v_720_f16.json`**
- **Description**: First-Last-Frame to Video generation at 720p
- **Features**: Generate video sequences from keyframes
- **Use Case**: Create smooth transitions between specific frames
- **Output**: 720p resolution, 16-bit precision

#### **`wan2.1_fun_control.json`**
- **Description**: Interactive control system for video generation
- **Features**: Dynamic parameter adjustment, real-time feedback
- **Use Case**: Experimental video creation with live controls

#### **`wan2.1_fun_inp.json`**
- **Description**: Video inpainting and object manipulation
- **Features**: Remove/replace objects in video, seamless editing
- **Use Case**: Video editing, object removal, content modification

## 🛠️ Technical Requirements

### Model Files Needed
- **Wan 2.1 1.3B**: `wan2.1_fun_camera_v1.1_1.3B.safetensors`
- **Wan 2.1 14B**: `wan2.1_fun_camera_v1.1_14B.safetensors`  
- **VAE**: Wan 2.1 VAE for video decoding
- **Text Encoder**: Compatible text encoder for prompting

### Hardware Requirements
| Model Size | RAM | VRAM | Recommended GPU |
|------------|-----|------|-----------------|
| 1.3B | 16 GB | 8 GB | RTX 3080/4070 |
| 14B | 32 GB | 16 GB | RTX 4080/4090 |

### Custom Nodes Required
- Wan video generation nodes
- Camera control extensions
- Video processing utilities

## 🎯 Usage Guide

### Quick Start (1.3B Model)
1. Load the `video_wan2.1_fun_camera_v1.1_1.3B` template
2. Set your text prompt for video content
3. Configure camera movement parameters
4. Adjust video length and resolution
5. Generate your video

### Professional Workflow (14B Model)
1. Use the 14B template for higher quality
2. Plan your camera movements in advance
3. Set keyframes for complex motions
4. Use higher resolution settings
5. Allow more time for generation

### Video Inpainting
1. Load the `wan2.1_fun_inp` template
2. Input your source video
3. Create a mask for areas to modify
4. Describe the desired changes
5. Generate the modified video

## 🎨 Creative Applications

### 🎬 Filmmaking
- **Previsualization**: Test camera angles before filming
- **Virtual Cinematography**: Create impossible camera movements
- **Concept Videos**: Rapid prototyping of video ideas

### 📱 Content Creation
- **Social Media**: Generate engaging video content
- **Marketing**: Product demonstrations with dynamic cameras
- **Education**: Animated explanations with smooth transitions

### 🎮 Game Development
- **Cutscenes**: Generate in-game cinematics
- **Trailers**: Create promotional videos
- **Concept Art**: Moving concept illustrations

## ⚙️ Advanced Configuration

### Camera Control Parameters
```json
{
  "camera_motion": "smooth_pan",
  "angle_change": 15,
  "speed": "medium",
  "focal_length": "50mm",
  "depth_of_field": true
}
```

### Video Quality Settings
```json
{
  "resolution": "1280x720",
  "fps": 24,
  "bit_depth": 16,
  "codec": "h264",
  "quality": "high"
}
```

## 🔧 Troubleshooting

### Common Issues
- **Out of Memory**: Reduce resolution or use 1.3B model
- **Slow Generation**: Check GPU utilization and model loading
- **Poor Quality**: Ensure proper model weights and settings

### Performance Tips
- Use FP16 precision for better memory efficiency
- Batch multiple short videos instead of one long video
- Pre-load models to reduce generation time

## 📊 Comparison: 1.3B vs 14B

| Feature | 1.3B Model | 14B Model |
|---------|------------|-----------|
| **Speed** | Fast (2-5 min) | Slower (10-20 min) |
| **Quality** | Good | Excellent |
| **Memory** | 8 GB VRAM | 16+ GB VRAM |
| **Use Case** | Prototyping | Production |

## 🌟 Success Stories

Users have created amazing content with Wan 2.1:
- **Indie Films**: Independent filmmakers using camera control for professional shots
- **Marketing Videos**: Brands creating engaging product demos
- **Art Projects**: Digital artists exploring new forms of moving image art

---

**🚀 Ready to Create?** Choose your template based on your hardware and quality needs, and start generating stunning videos with Wan 2.1!
