# PS2 → PSP Converter

AI-powered experimental pipeline that attempts to analyze an extracted PS2 game folder and generate a PSP-oriented game build using the Perplexity API.

> **WARNING**: This project is purely experimental and intended for research and educational purposes only. It does *not* include, ship, or grant rights to any game content.

## High-level flow

1. User provides:
   - Path to extracted PS2 game folder
   - Perplexity API key
2. Tool scans and fingerprints game assets and code.
3. Tool calls the Perplexity API iteratively to:
   - Infer engine / middleware / formats
   - Suggest equivalent PSP-friendly structures
   - Propose code/adaptation strategies
4. Tool generates a new PSP project structure under `output/`.
5. All errors are handled internally; if an unrecoverable error happens, a crash report is written to the desktop.

---

This repository is scaffolded by an AI assistant and still needs substantial domain-specific work for real PS2→PSP conversion.
