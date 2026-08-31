//go:build windows

package genaiproxy

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func launchDaemon(options DaemonOptions) (int, error) {
	executable, err := os.Executable()
	if err != nil {
		return 0, err
	}
	daemonExecutable := filepath.Join(filepath.Dir(executable), "athenzd-genai-proxy.exe")
	if _, err := os.Stat(daemonExecutable); err != nil {
		daemonExecutable, err = exec.LookPath("athenzd-genai-proxy.exe")
		if err != nil {
			return 0, fmt.Errorf("finding athenzd-genai-proxy executable: install both binaries with `make -C components/athenzd build`: %w", err)
		}
	}
	logFile, err := os.OpenFile(options.LogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return 0, err
	}
	defer logFile.Close()
	command := exec.Command(daemonExecutable, "--file", options.ConfigPath)
	command.Stdin = nil
	command.Stdout = logFile
	command.Stderr = logFile
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008}
	if err := command.Start(); err != nil {
		return 0, err
	}
	pid := command.Process.Pid
	if err := command.Process.Release(); err != nil {
		return 0, err
	}
	return pid, nil
}
