package main

import (
	"fmt"
	"io"
	"os"

	"golang.org/x/term"
)

type projectSelector func(io.Reader, io.Writer, []string) (string, error)

const (
	athenzFocusColor = "\x1b[38;2;33;90;242m" // Athenz blue: #215af2
	resetColor       = "\x1b[0m"
)

type selectionKind struct {
	name     string
	question string
}

var (
	projectSelection = selectionKind{name: "GenAI project", question: "Which GenAI project do you want to use?"}
	scopeSelection   = selectionKind{name: "GenAI scope", question: "Which GenAI scope do you want to use?"}
)

var (
	isTerminal = term.IsTerminal
	makeRaw    = term.MakeRaw
	restore    = term.Restore
)

func promptDefaultProject(in io.Reader, out io.Writer, choices []string) (string, error) {
	return promptSelection(in, out, choices, projectSelection)
}

func promptGenAIScope(in io.Reader, out io.Writer, choices []string) (string, error) {
	return promptSelection(in, out, choices, scopeSelection)
}

func promptSelection(in io.Reader, out io.Writer, choices []string, kind selectionKind) (string, error) {
	if len(choices) == 0 {
		return "", fmt.Errorf("no eligible %ss are available", kind.name)
	}
	input, ok := in.(*os.File)
	if !ok || !isTerminal(int(input.Fd())) {
		return "", fmt.Errorf("an interactive terminal is required to choose a %s", kind.name)
	}
	state, err := makeRaw(int(input.Fd()))
	if err != nil {
		return "", fmt.Errorf("enabling interactive %s selection: %w", kind.name, err)
	}
	defer restore(int(input.Fd()), state) //nolint:errcheck
	return runSelectionPrompt(input, out, choices, kind)
}

func runProjectPrompt(in io.Reader, out io.Writer, choices []string) (string, error) {
	return runSelectionPrompt(in, out, choices, projectSelection)
}

func runSelectionPrompt(in io.Reader, out io.Writer, choices []string, kind selectionKind) (string, error) {
	if len(choices) == 0 {
		return "", fmt.Errorf("no eligible %ss are available", kind.name)
	}
	selected := 0
	fmt.Fprintf(out, "%s (↑/↓ and Enter)\r\n", kind.question)
	renderProjectChoices(out, choices, selected, false)

	var key [1]byte
	for {
		if _, err := io.ReadFull(in, key[:]); err != nil {
			return "", fmt.Errorf("reading %s selection: %w", kind.name, err)
		}
		switch key[0] {
		case '\r', '\n':
			fmt.Fprintf(out, "\r\x1b[2KSelected: %s\r\n", choices[selected])
			return choices[selected], nil
		case 3:
			return "", fmt.Errorf("%s selection canceled", kind.name)
		case 27:
			var sequence [2]byte
			if _, err := io.ReadFull(in, sequence[:]); err != nil {
				return "", fmt.Errorf("reading %s selection: %w", kind.name, err)
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
		color, reset := "", ""
		if i == selected {
			cursor = "> "
			color, reset = athenzFocusColor, resetColor
		}
		fmt.Fprintf(out, "\r\x1b[2K%s%s%s%s\r\n", color, cursor, choice, reset)
	}
}
