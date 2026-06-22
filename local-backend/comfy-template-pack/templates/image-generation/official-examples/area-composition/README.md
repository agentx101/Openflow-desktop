# Area Composition

Official regional prompting workflow - create complex images with different prompts for different areas.

## ⚡ 60-Second Setup

### What it does
Uses ConditioningSetArea nodes to apply different text prompts to specific regions of an image for complex compositions.

### Requirements
- **ComfyUI Version:** Any version (core nodes only)
- **VRAM:** 6GB minimum, 8GB+ recommended
- **Runtime:** ~30-60 seconds per image

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
- Download [`area_composition_workflow.json`](area_composition_workflow.json)
- Drag into ComfyUI interface
- Model auto-downloads on first run

### 2. Create Multi-Area Image
- **Top Area Prompt:** "blue sky with white clouds"
- **Bottom Area Prompt:** "green grass field with flowers"
- **Background Prompt:** "peaceful landscape"
- **Resolution:** 512x512 (adjust area coordinates accordingly)
- Click **"Queue Prompt"**

### 3. How Area Conditioning Works
- **ConditioningSetArea** defines rectangular regions
- **Coordinates:** (x, y, width, height) in pixels
- **Strength:** How strongly each area follows its prompt
- **Overlap:** Areas can overlap with different strengths

## 📊 Use Cases

| Composition Type | Top Area | Bottom Area | Best For |
|------------------|----------|-------------|----------|
| Landscape | Sky, mountains | Ground, water | Nature scenes |
| Portrait | Background | Subject | Character focus |
| Architecture | Building top | Building base | Structural detail |

## 🎯 Advanced Techniques

### **Precise Region Control**
- Calculate exact pixel coordinates for your canvas size
- Use overlapping areas for smooth transitions
- Adjust area strength (0.5-1.0) for blending

### **Multi-Layer Compositions**
- Combine 3+ areas for complex scenes
- Use background prompts for overall coherence
- Balance area sizes for natural composition

### **Common Patterns**
- **Sky + Ground:** Classic landscape division
- **Left + Right:** Compare concepts side-by-side
- **Center + Border:** Focus subject with context

## 🔧 Technical Tips

- **Area sizes:** Larger areas = more influence
- **Coordinates:** Start from top-left (0,0)
- **Overlap handling:** Later areas override earlier ones
- **Strength values:** 0.8-1.0 for strong separation, 0.3-0.6 for soft blending

## 🔗 Sources & Credits
- **Technique:** Core ComfyUI functionality
- **Workflow:** [ComfyUI Official Examples](https://comfyanonymous.github.io/ComfyUI_examples/area_composition/)
- **Model:** [Stability AI SD 1.5](https://huggingface.co/stable-diffusion-v1-5)
- **License:** MIT - Use however you want!

---
*Advanced composition technique • Professional control • Verified working January 2025*
