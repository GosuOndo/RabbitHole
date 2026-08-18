import type { SeedProject } from "../types";

export const EMULATION_PROJECTS: SeedProject[] = [
  {
    slug: "chip-8-emulator",
    title: "Build a CHIP-8 emulator",
    summary: "Emulate a tiny 1970s virtual machine — 35 opcodes, a 64x32 display, a hex keypad — and play Pong on it.",
    description:
      "CHIP-8 is the traditional first emulator: 4 KB of memory, sixteen registers, a stack, two timers, a monochrome display and thirty-five instructions you can implement in an afternoon. Write the fetch-decode-execute loop, render the display, wire the keypad, and load public-domain ROMs. When Pong or Space Invaders starts running on your code, you will understand what an emulator really is.\n\nThen tackle the fun details: the timing of instructions versus the 60 Hz timers, quirks that differ between interpreters and break specific games, a debugger that steps and shows registers, and sound. Ports to the browser, a terminal, or a microcontroller are natural. It is the on-ramp to Game Boy and NES emulation.",
    difficulty: "BEGINNER",
    estimatedHours: 6,
    popularity: 0.75,
    tags: ["emulation", "systems", "game-development"],
    languages: ["rust", "c", "typescript", "go", "python"],
    concepts: ["fetch-decode-execute loops", "opcode decoding", "memory-mapped display", "timers and timing", "debuggers"],
    sourceUrl: "http://devernay.free.fr/hacks/chip8/C8TECH10.HTM",
  },
  {
    slug: "game-boy-emulator",
    title: "Build a Game Boy emulator",
    summary: "Emulate the Sharp SM83 CPU, the pixel-processing unit, timers, input and cartridge banking accurately enough to play Tetris.",
    description:
      "The Game Boy is the perfect serious emulation target: thoroughly documented, small enough to be tractable, and rewarding at every step. Implement the CPU with its roughly five hundred opcodes and pass Blargg's test ROMs; then the PPU with its scanline modes, background, window and sprite rendering; then timers, interrupts and joypad input. Seeing the Nintendo logo scroll down for the first time is unforgettable.\n\nThen add memory bank controllers so larger cartridges work, audio with its four channels, save RAM, and cycle-accurate timing so demanding games behave. A debugger with breakpoints and a VRAM viewer will save you hours. The Pan Docs are the bible; a test-ROM-driven approach keeps you honest.",
    difficulty: "ADVANCED",
    estimatedHours: 60,
    popularity: 0.65,
    tags: ["emulation", "systems", "game-development"],
    languages: ["rust", "c", "cpp", "go"],
    concepts: ["CPU emulation and instruction timing", "PPU scanline rendering", "interrupts and timers", "memory bank controllers", "test-ROM-driven development"],
    sourceUrl: "https://gbdev.io/pandocs/",
  },
  {
    slug: "6502-cpu-emulator",
    title: "Emulate the 6502 CPU",
    summary: "Implement the processor inside the NES, Apple II and Commodore 64, then run real 6502 programs and test suites.",
    description:
      "The 6502 has three registers, a handful of flags and fifty-six instructions with thirteen addressing modes, which is just enough complexity to be interesting. Implement the instruction set, the status flags with their notorious edge cases (decimal mode, overflow), the stack, and cycle counts, and validate against comprehensive test suites that check every opcode in every mode.\n\nThen give it something to run: a simple memory-mapped serial output so BASIC or Wozmon can run, or a small display for a hand-written game. It is the CPU half of a NES emulator, and finishing it means you are one PPU away from playing Super Mario Bros on your own code.",
    difficulty: "INTERMEDIATE",
    estimatedHours: 12,
    popularity: 0.5,
    tags: ["emulation", "systems"],
    languages: ["c", "rust", "typescript", "python"],
    concepts: ["instruction set implementation", "addressing modes", "status flags and edge cases", "cycle counting", "test-suite validation"],
    sourceUrl: "http://www.6502.org/",
  },
  {
    slug: "risc-v-emulator",
    title: "Write a RISC-V emulator that boots a small OS",
    summary: "Implement RV32I/RV64I, privilege modes, traps and a few devices, then boot xv6 or a tiny kernel on it.",
    description:
      "RISC-V's base integer ISA is small and cleanly specified, so a user-mode emulator that runs compiled C programs is achievable quickly: decode the instruction formats, implement the arithmetic, load/store, branch and jump instructions, and a system-call shim. Then go deeper: CSRs, machine and supervisor privilege modes, traps and interrupts, a UART, a timer and virtual memory with page-table walks.\n\nWith those in place you can boot a real operating system such as xv6-riscv on your emulator, which is a remarkable milestone. Add a debugger, run the official compliance tests, and compare speed against QEMU. It is the most complete tour of computer architecture a software project can offer.",
    difficulty: "ADVANCED",
    estimatedHours: 30,
    popularity: 0.4,
    tags: ["emulation", "systems", "operating-systems"],
    languages: ["rust", "c", "zig", "go"],
    concepts: ["ISA decoding", "privilege levels and CSRs", "traps and interrupts", "virtual memory emulation", "device emulation (UART, timer)"],
    sourceUrl: "https://riscv.org/technical/specifications/",
  },
];
