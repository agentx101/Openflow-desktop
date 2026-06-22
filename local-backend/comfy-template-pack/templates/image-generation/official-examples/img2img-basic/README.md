# Basic Img2Img

Official image-to-image transformation workflow - transform any image using text prompts while preserving structure.

## ⚡ 60-Second Setup

### What it does
Transforms existing images based on text prompts while maintaining the original composition and structure.

### Requirements
- **ComfyUI Version:** Any version (core nodes only)
- **VRAM:** 4GB minimum, 6GB+ recommended  
- **Runtime:** ~20-40 seconds per image

### Required Models
```
ComfyUI/models/checkpoints/v1-5-pruned-emaonly.safetensors (4GB)
```
📥 **Auto-download:** [Stable Diffusion 1.5 Official](https://huggingface.co/stable-diffusion-v1-5)

### Custom Nodes Required
- **None** - Uses ComfyUI core nodes only ✅

### Last Verified
- **Date:** January 2025
- **ComfyUI SHA:** Latest stable
- **Status:** ✅ Works on clean install

---

## 🚀 Quick Usage

### 1. Download & Import
- Download [`img2img_basic.json`](img2img_basic.json)
- Drag into ComfyUI interface
- Model auto-downloads on first run

### 2. Transform Your First Image
- **Input Image:** Load any image (512x512 works best)
- **Prompt:** "oil painting, artistic style, detailed"
- **Negative:** "blurry, low quality, distorted"
- **Denoise Strength:** 0.75 (how much to change: 0.1=subtle, 1.0=complete)
- **Steps:** 20 (good balance)
- **CFG Scale:** 7 (prompt adherence)
- Click **"Queue Prompt"**

### 3. Key Parameters

- **Denoise Strength:** Most important setting!
  - **0.1-0.3:** Subtle style changes, keep original details
  - **0.4-0.7:** Moderate transformation, good balance  
  - **0.8-1.0:** Heavy transformation, may lose original structure

## 📊 Transformation Examples

| Denoise | Change Level | Best For |
|---------|--------------|----------|
| 0.2 | Subtle | Color correction, minor style tweaks |
| 0.5 | Moderate | Style transfer, artistic effects |
| 0.8 | Heavy | Major transformations, different art styles |

## 🎯 Use Cases & Tips

### **Style Transfer**
- Prompt: "watercolor painting", "pencil sketch", "oil painting"
- Denoise: 0.4-0.6

### **Photo Enhancement**
- Prompt: "professional photography, sharp, detailed"  
- Denoise: 0.2-0.3

### **Artistic Effects**
- Prompt: "fantasy art, magical, glowing"
- Denoise: 0.6-0.8

### **Object Changes**
- Prompt: "red car instead of blue car"
- Denoise: 0.3-0.5

## 🔧 Advanced Tips

- **Preserve structure:** Use lower denoise strength (0.2-0.4)
- **Major changes:** Use higher denoise strength (0.7-0.9)
- **Better results:** Match aspect ratio of input image
- **Inpainting:** For precise edits, use dedicated inpainting workflows

## 🔗 Sources & Credits
- **Technique:** Core Stable Diffusion functionality
- **Workflow:** [ComfyUI Official Examples](https://comfyanonymous.github.io/ComfyUI_examples/img2img/)
- **Model:** [Stability AI SD 1.5](https://huggingface.co/stable-diffusion-v1-5)
- **License:** MIT - Use however you want!

---
*Fundamental technique • Essential for image editing • Verified working January 2025*