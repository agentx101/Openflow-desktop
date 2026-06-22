# AnimateDiff Community Workflows

Community-contributed AnimateDiff workflows for advanced video generation and video-to-video transformation.

## 🎬 Available Workflows

### UltimateLCM Vid2Vid Workflow
**File:** `ultimatelcm_vid2vid_workflow.json`  
**Source:** OpenArt.ai (by jboogx/Gabriel Jiménez)  
**Type:** Video-to-Video Generation  

**Description:**
Advanced AnimateDiff workflow combining UltimateLCM (Latent Consistency Model) with Vid2Vid capabilities for rapid, high-quality video transformation and generation.

**Key Features:**
- ⚡ Ultra-fast generation with LCM acceleration
- 🎯 Video-to-video transformation
- 🎨 Style transfer capabilities
- 🔄 Motion consistency preservation
- 📱 Optimized for various aspect ratios

**Requirements:**
- **GPU Memory:** 8GB+ VRAM recommended
- **Models:** AnimateDiff, LCM LoRA, SD 1.5 base model
- **Custom Nodes:** AnimateDiff Evolved, LCM nodes

**Usage:**
1. Load your source video in the video input node
2. Configure LCM settings (typically 4-8 steps)
3. Adjust motion strength and style parameters
4. Set output video dimensions and frame count
5. Run workflow for rapid video generation

**Tips:**
- Lower step counts (4-6) work best with LCM
- Use CFG scale between 1.0-2.0 for LCM
- Experiment with motion scale for different effects
- Works well with short clips (2-4 seconds)

**Community Rating:** ⭐⭐⭐⭐⭐ (5.0/5)  
**Downloads:** 66.1K+  
**Last Updated:** 2024

## 📁 Workflow Structure

```
ultimatelcm_vid2vid_workflow.json
├── Video Input Nodes
├── AnimateDiff Pipeline
├── LCM Acceleration
├── Style Control
└── Video Output
```

## 🔗 Related Resources

- [AnimateDiff Official Repository](https://github.com/guoyww/AnimateDiff)
- [LCM Documentation](https://huggingface.co/latent-consistency)
- [Video Generation Best Practices](../../video-processing/README.md)

## 🤝 Contributing

Found improvements or variations? Please contribute back to the community!

---

*Curated from OpenArt.ai community workflows*
