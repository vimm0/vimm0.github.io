---
layout: post
title: "How to Fine-Tune LLM to be Efficient in Local Machine"
date:   2026-03-04 00:00:00 +0700
categories: machine learning artificial-intelligence local-llm
---

Large language models (LLMs) have become increasingly popular, but many developers struggle with the idea of running them locally — whether due to limited hardware resources, cost concerns, or privacy requirements. In this article, I will show you how to **fine-tune LLMs efficiently on your local machine**.

## Understanding Fine-Tuning vs. Inference

Before diving into fine-tuning, it's important to understand the difference between training and inference:

- **Training**: Creating a model from scratch or initializing weights with pre-trained data
- **Fine-Tuning**: Adapting a pre-trained model to specific tasks/domains using small datasets  
- **Inference**: Running a trained model for generating text responses

You can run models at scale without fine-tuning by:

1. Using quantization (`8-bit`, `4-bit`, `INT2`)
2. Employing smaller parameter counts (7B, 13B, even 3B)  
3. Implementing optimizations like attention slicing and memory pooling
4. Running on consumer GPUs (e.g., RTX 3090/4090 with 24GB VRAM) or Mac M-series processors

```bash
# Check your GPU memory availability
nvidia-smi

# Or for Mac users
sysctl hw.physicalmemory
```

## Hardware Requirements for Local Fine-Tuning

| Hardware | Minimum Required | Recommended |
|----------|-----------------|-------------|
| **CPU**   | 8 Core          | 16+ Cores   |
| **RAM**   | 16 GB           | 32-64 GB    |
| **GPU**   | GTX 1650 (4GB)  | RTX 3090/4090 (24GB VRAM) |
| **NVMe**  | 120 GB          | 500 GB+     |

For Apple Silicon users, the Neural Engine + Metal support enables high inference speeds even for large models.

## Step 1: Choose Your Model Carefully

Start with smaller models that are easier to fine-tune locally:

- **Llama-2-7b** and variants (good general-purpose model)
- **Mistral-7b** - High quality, efficient inference  
- **Quantization**: Use GGUF format for optimal storage (Q4_K_M, Q5_K_M recommended)

```bash
# Download using Hugging Face CLI
huggingface-cli download mistralai/Mistral-7B-Instruct-v0.2 \
  --local-dir ./models/Mistral-7B-Instruct-v0.2 \
  --include "*.gguf"
```

## Step 2: Installation and Setup

### For Linux/Windows Users with Nvidia GPU

```bash
# Install PyTorch with CUDA support
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Installation commands for PEFT and LoRA fine-tuning
pip install transformers peft accelerate bitsandbytes trl

# For quantization  
pip install auto-gptq flash-attn ninja xformers

# Verify GPU availability
python -c "import torch; print(torch.cuda.is_available())"
```

### For Apple Silicon Users (Mac M1/M2/M3)

```bash
# Use `mlx` framework for fast inference on Mac
pip install mlx-lm transformers datasets sentencepiece

# OR use llama.cpp via pip  
pip install -U git+https://github.com/jllllll/llama-cpp-python.git
```

## Step 3: Prepare Your Dataset

Before fine-tuning, you need clean, formatted data. Let's create a sample dataset:

```python
from datasets import Dataset

# Create custom fine-tuning dataset in alpaca format
alpaca_data_path = "data/alpaca_gpt4_data_clean"

def load_finetune_dataset(alpaca_data_path):
    import json
    with open(f"{alpaca_data_path}/instruction.json", "r") as f:
        data = json.load(f)
        
    dataset = []
    for sample in data[:10]:  # Limit to 10 samples for demo
        dataset.append({
            "input": "",
            "output": f"You are a helpful assistant. {sample['instruction']}",
            "instruction": sample["instruction"],  
            "text": ""
            })
            
    return Dataset.from_list(dataset)

dataset = load_finetune_dataset(alpaca_data_path)
```

## Step 4: Fine-Tuning Using PEFT (Parameter-Efficient Fine-tuning)

PEFT methods like **LoRA** require fewer resources while maintaining high performance:

```python
from transformers import TrainingArguments
from trl import SFTTrainer, ScriptArguments
from peft import LoraConfig, PeftModel

# Configure LoRA parameters
peft_config = LoraConfig(
    task_type="CAUSAL_LM",  
    r=16,
    target_modules=["q_proj", "v_proj"],
    lora_alpha=32
)

args = ScriptArguments(
    data_path='data/alpaca_gpt4_data_clean',
    output_dir='./finetuned-model',
    max_seq_length=512,
    num_train_epochs=3,
    per_device_train_batch_size=2,  # Small due to GPU limitation  
    learning_rate=2e-4
)

training_params = TrainingArguments(
    warmup_steps=5,
    logging_steps=1,
    max_grad_norm=0.3,
    lr_scheduler_type='constant'
)
```

## Step 5: Using llama.cpp for Quantized Inference

llama.cpp offers an optimized inference engine that works well with limited hardware:

```bash
# Download and build llama.cpp  
git clone https://github.com/ggerganov/llama.cpp.git --recursive
cd llama.cpp && make

# Convert your model to GGUF format for quantization  
./convert-hf-to-gguf-v2 ./models/Mistral-7B-Instruct-v0.2 \
  ./mistral-7b-instruct.Q4_K_M.gguf -q4_k_m

# Run inference locally   
./main ./mistral-7b-instruct.Q4_K_M.gguf -p "<your_prompt>" \
  --n-gpu-layers 99 --temp 0.7 --repeat-penalty 1.1
```

## Step 6: Memory Management & Optimization Tips

### Using LoRA for Efficient Fine-Tuning

Reduce VRAM usage by training only adapters instead of full model weights. This approach allows fine-tuning on consumer hardware.

### Use `bitsandbytes` for 8-bit or 4-bit Quantization

This reduces memory footprint significantly:

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig

bnb_config = BitsAndBytesConfig(
    load_in_8bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16
)
```

### Use FlashAttention (if available and supported by your hardware)

Flash attention can significantly reduce GPU memory usage during both training and inference. Note: not all models support it yet.

## Step 7: Using Ollama for Simplified Deployment

[`Ollama`](https://ollama.com/) provides an easy-to-use CLI tool for running and fine-tuning models locally.

### Installation

```bash
# For macOS/Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Run a model
ollama run mistral-instruct:7b

# Pull models  
ollama pull llama2:7b
```

## Step 8: Evaluating Results After Fine-Tuning

Use metrics like perplexity, BLEU score, or ROUGE to evaluate your fine-tuned model:

```python
from datasets import load_dataset
from transformers import pipeline

generation = pipeline(
    task="text-generation", 
    model="./finetuned-model",  
    device=-1
)

test_prompt = "What is the capital of France?"  
result = generation(test_prompt, max_new_tokens=50)
print(result[0]["generated_text"])
```

## Conclusion

Fine-tuning Large Language Models locally has become more accessible with advances in tools like PEFT, quantization, and efficient inference engines. By following the steps outlined above:

1. Start with smaller models (7B-13B parameters)
2. Use **quantization** (8-bit/4-bit) to reduce VRAM usage  
3. Apply **LoRA adapters** for parameter-efficient fine-tuning
4. Leverage tools like **llama.cpp**, **Ollama**, and **bitsandbytes**

You can create powerful local AI assistants without depending on cloud APIs, respecting user privacy and avoiding subscription costs.

## Cost Comparison: Local vs. Cloud

| Approach | Monthly Cost | Speed | Privacy Control |
|----------|--------------|-------|-----------------|
| **Cloud API**   | $20-500 + usage  | High | No      |
| **Local Inference (GGUF)** | $0    | Medium-High | Full control |
| **Fine-Tuned Model**   | $0    | Highest | Maximum |

## Final Tips

- Start small and measure performance improvement vs. time-to-train  
- Keep your fine-tuned datasets small (<1000 examples) for faster iteration
- Share your quantized model files with friends to avoid re-uploading large files repeatedly

## References

- [Hugging Face Transformers Documentation](https://huggingface.co/docs/transformers/)  
- [The Complete Guide to Fine-Tuning LLMs](https://www.deeplearning.ai/articles/241789/how-to-fine-tune-large-language-models/)
- [LLaMA-Factory - Multi-Model Fine-Tuning Framework](https://github.com/hiyouga/LLaMA-Factory)  
- [llama.cpp Documentation](https://github.com/ggerganov/llama.cpp)

---

_Original source: Local LLM optimization guide_
