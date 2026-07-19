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
	idJAG, scope, err := idJAGForProject(idJAGs, project, cfg.GenAI.Role)
	if err != nil {
		return nil, err
	}
	client, err := zts.NewIdentityClient(cfg.Athenz.ZTS, cfg.Athenz.CAFile,
		service.Identity.CertFile, service.Identity.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("creating X.509-authenticated ZTS client for default access token: %w", err)
	}
	result, err := accesstoken.Issue(ctx, client, idJAG.Token, scope)
	if err != nil {
		return nil, fmt.Errorf("issuing default GenAI access token: %w", err)
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

func idJAGForProject(entries map[string]cache.IDJAGEntry, project, baselineRole string) (cache.IDJAGEntry, string, error) {
	if err := genai.ValidateService(project); err != nil {
		return cache.IDJAGEntry{}, "", err
	}
	for _, entry := range entries {
		if entry.Service != project {
			continue
		}
		baselineScope := genai.Scope(entry.Domain, baselineRole)
		for _, grantedScope := range scopeFields(entry.Scope) {
			if grantedScope == baselineScope {
				return entry, baselineScope, nil
			}
		}
		return cache.IDJAGEntry{}, "", fmt.Errorf("GenAI project %q ID-JAG does not include its baseline scope %q", project, baselineScope)
	}
	return cache.IDJAGEntry{}, "", fmt.Errorf("default GenAI project %q is not eligible for this login", project)
}
