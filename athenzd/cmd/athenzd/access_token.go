package main

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/AthenZ/athenzd/internal/accesstoken"
	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/AthenZ/athenzd/internal/zts"
)

func issueDefaultAccessToken(ctx context.Context, cfg *config.Config, service *config.ServiceConfig,
	idJAGs map[string]cache.IDJAGEntry, project string) (*cache.AccessTokenEntry, error) {
	idJAG, scopes, err := eligibleScopesForProject(idJAGs, project)
	if err != nil {
		return nil, err
	}
	scope := genai.Scope(idJAG.Domain, cfg.GenAI.Role)
	if !containsScope(scopes, scope) {
		return nil, fmt.Errorf("GenAI project %q ID-JAG does not include its baseline scope %q", project, scope)
	}
	entry, err := issueAccessToken(ctx, cfg, service, idJAG, project, scope)
	if err != nil {
		return nil, fmt.Errorf("issuing default GenAI access token: %w", err)
	}
	return entry, nil
}

func issueAccessToken(ctx context.Context, cfg *config.Config, service *config.ServiceConfig,
	idJAG cache.IDJAGEntry, project, scope string) (*cache.AccessTokenEntry, error) {
	client, err := zts.NewIdentityClient(cfg.Athenz.ZTS, cfg.Athenz.CAFile,
		service.Identity.CertFile, service.Identity.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("creating X.509-authenticated ZTS client for access token: %w", err)
	}
	result, err := accesstoken.Issue(ctx, client, idJAG.Token, scope)
	if err != nil {
		return nil, err
	}
	return &cache.AccessTokenEntry{
		Project:   project,
		Scope:     result.Scope,
		Token:     result.Token,
		TokenType: result.TokenType,
		ExpiresAt: time.Now().Add(time.Duration(result.ExpiresIn) * time.Second),
	}, nil
}

func cacheLoginAccessToken(serviceName string, entry *cache.TokenEntry) error {
	if err := cache.Save(serviceName, *entry); err != nil {
		return fmt.Errorf("caching default GenAI access token: %w", err)
	}
	return nil
}

func defaultProjectChoices(entries map[string]cache.IDJAGEntry) []string {
	set := map[string]struct{}{}
	for _, entry := range entries {
		if entry.Service != "" {
			set[entry.Service] = struct{}{}
		}
	}
	choices := make([]string, 0, len(set))
	for project := range set {
		choices = append(choices, project)
	}
	sort.Strings(choices)
	return choices
}

func eligibleScopesForProject(entries map[string]cache.IDJAGEntry, project string) (cache.IDJAGEntry, []string, error) {
	if err := genai.ValidateService(project); err != nil {
		return cache.IDJAGEntry{}, nil, err
	}
	for _, entry := range entries {
		if entry.Service != project {
			continue
		}
		return entry, scopeFields(entry.Scope), nil
	}
	return cache.IDJAGEntry{}, nil, fmt.Errorf("GenAI project %q is not eligible for this login", project)
}

func containsScope(scopes []string, wanted string) bool {
	for _, scope := range scopes {
		if scope == wanted {
			return true
		}
	}
	return false
}
