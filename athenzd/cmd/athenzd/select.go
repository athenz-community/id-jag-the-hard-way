package main

import (
	"fmt"
	"io"
	"os"

	"golang.org/x/term"
)

type projectSelector func(io.Reader, io.Writer, []string) (string, error)

var (
	isTerminal = term.IsTerminal
	makeRaw    = term.MakeRaw
	restore    = term.Restore
)

func promptDefaultProject(in io.Reader, out io.Writer, choices []string) (string, error) {
	if len(choices) == 0 {
		return "", fmt.Errorf("no eligible GenAI projects are available")
	}
	input, ok := in.(*os.File)
	if !ok || !isTerminal(int(input.Fd())) {
		return "", fmt.Errorf("gen_ai.default_project is not set and an interactive terminal is required to choose it")
	}
	state, err := makeRaw(int(input.Fd()))
	if err != nil {
		return "", fmt.Errorf("enabling interactive GenAI project selection: %w", err)
	}
	defer restore(int(input.Fd()), state) //nolint:errcheck
	return runProjectPrompt(input, out, choices)
}

func runProjectPrompt(in io.Reader, out io.Writer, choices []string) (string, error) {
	if len(choices) == 0 {
		return "", fmt.Errorf("no eligible GenAI projects are available")
	}
	selected := 0
	fmt.Fprint(out, "Which GenAI project do you want to use? (↑/↓ and Enter)\r\n")
	renderProjectChoices(out, choices, selected, false)

	var key [1]byte
	for {
		if _, err := io.ReadFull(in, key[:]); err != nil {
			return "", fmt.Errorf("reading GenAI project selection: %w", err)
		}
		switch key[0] {
		case '\r', '\n':
			fmt.Fprintf(out, "\r\x1b[2KSelected: %s\r\n", choices[selected])
			return choices[selected], nil
		case 3:
			return "", fmt.Errorf("GenAI project selection canceled")
		case 27:
			var sequence [2]byte
			if _, err := io.ReadFull(in, sequence[:]); err != nil {
				return "", fmt.Errorf("reading GenAI project selection: %w", err)
			}
			if sequence[0] != '[' {
				continue
			}
			switch sequence[1] {
			case 'A':
				selected = (selected - 1 + len(choices)) % len(choices)
			case 'B':
				selected = (selected + 1) % len(choices)
			default:
				continue
			}
			renderProjectChoices(out, choices, selected, true)
		}
	}
}

func renderProjectChoices(out io.Writer, choices []string, selected int, redraw bool) {
	if redraw {
		fmt.Fprintf(out, "\x1b[%dA", len(choices))
	}
	for i, choice := range choices {
		cursor := "  "
		if i == selected {
			cursor = "> "
		}
		fmt.Fprintf(out, "\r\x1b[2K%s%s\r\n", cursor, choice)
	}
}
