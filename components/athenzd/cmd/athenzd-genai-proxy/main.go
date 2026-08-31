package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genaiproxy"
)

type proxyServer func(context.Context, genaiproxy.Options) error

func run(ctx context.Context, args []string, output io.Writer, server proxyServer) error {
	flags := flag.NewFlagSet("athenzd-genai-proxy", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var file string
	flags.StringVar(&file, "file", "", "path to config file")
	flags.StringVar(&file, "f", "", "path to config file")
	if err := flags.Parse(args); err != nil {
		return fmt.Errorf("parsing daemon arguments: %w", err)
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("athenzd-genai-proxy accepts no positional arguments")
	}

	resolved, err := config.Resolve(file)
	if err != nil {
		return err
	}
	cfg, err := config.LoadResolved(resolved)
	if err != nil {
		return err
	}
	if cfg.GenAI.Proxy == nil {
		return fmt.Errorf("gen_ai.proxy is not configured")
	}
	if cfg.CurrentService == "" {
		return fmt.Errorf("current_service is not set in config")
	}
	return server(ctx, genaiproxy.Options{
		Port:        cfg.GenAI.Proxy.Port,
		UpstreamURL: cfg.GenAI.Proxy.UpstreamURL,
		InstanceID:  genaiproxy.InstanceID(resolved.Path),
		TokenSource: cachedTokenSource(cfg.CurrentService),
		Output:      output,
	})
}

func cachedTokenSource(serviceName string) genaiproxy.TokenSource {
	return func() (*genaiproxy.AccessToken, error) {
		cached, err := cache.Load(serviceName)
		if err != nil {
			return nil, err
		}
		if cached.AccessToken == nil {
			return nil, nil
		}
		return &genaiproxy.AccessToken{
			Token:     cached.AccessToken.Token,
			ExpiresAt: cached.AccessToken.ExpiresAt,
		}, nil
	}
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout, genaiproxy.Run); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
