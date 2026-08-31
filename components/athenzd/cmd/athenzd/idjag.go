package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/AthenZ/athenzd/internal/idjag"
	"github.com/AthenZ/athenzd/internal/zms"
	"github.com/AthenZ/athenzd/internal/zts"
)

func issueIDJAGs(ctx context.Context, cfg *config.Config, service *config.ServiceConfig,
	idToken string, target zms.Target, rolesDiscovered func([]genai.ServiceScopes)) (map[string]cache.IDJAGEntry, error) {
	zmsClient, err := zms.NewClient(cfg.Athenz.ZMS, cfg.Athenz.CAFile)
	if err != nil {
		return nil, fmt.Errorf("creating ZMS client for GenAI role discovery: %w", err)
	}
	issuer := idjag.NewIssuer(zmsClient, func() (idjag.TokenExchanger, error) {
		client, err := zts.NewIdentityClient(cfg.Athenz.ZTS, cfg.Athenz.CAFile,
			service.Identity.CertFile, service.Identity.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("creating X.509-authenticated ZTS client: %w", err)
		}
		return client, nil
	})
	request := idjag.Request{
		SubjectToken:      idToken,
		UserPrincipal:     target.UserPrincipal,
		WorkloadPrincipal: target.ServiceIdentity,
		DomainTemplate:    cfg.GenAI.Domain,
		BaselineRole:      cfg.GenAI.Role,
	}
	projects, err := issuer.Discover(ctx, request)
	if err != nil {
		return nil, err
	}
	if rolesDiscovered != nil {
		rolesDiscovered(projects)
	}
	results, err := issuer.IssueDiscovered(ctx, request.SubjectToken, projects)
	if err != nil {
		return nil, err
	}
	entries := make(map[string]cache.IDJAGEntry, len(results))
	for _, result := range results {
		entries[result.Service] = newCachedIDJAG(result, time.Now())
	}
	return entries, nil
}

func newCachedIDJAG(result idjag.Result, issuedAt time.Time) cache.IDJAGEntry {
	return cache.IDJAGEntry{
		Service:   result.Service,
		Domain:    result.Domain,
		Token:     result.Token,
		Scope:     result.Scope,
		ExpiresAt: issuedAt.Add(time.Duration(result.ExpiresIn) * time.Second),
	}
}

func sortedIDJAGs(entries map[string]cache.IDJAGEntry) []cache.IDJAGEntry {
	services := make([]string, 0, len(entries))
	for service := range entries {
		services = append(services, service)
	}
	sort.Strings(services)
	result := make([]cache.IDJAGEntry, 0, len(services))
	for _, service := range services {
		result = append(result, entries[service])
	}
	return result
}

func scopeFields(scope string) []string { return strings.Fields(scope) }

func formatEligibleRoles(userPrincipal string, projects []genai.ServiceScopes) []string {
	lines := []string{fmt.Sprintf("✓ Eligible roles for %s:", userPrincipal)}
	for _, project := range projects {
		for _, scope := range project.Scopes {
			lines = append(lines, "  - "+scope)
		}
	}
	return lines
}

func idJAGSkipLog(err error) string {
	var noEligible *idjag.NoEligibleProjectsError
	if errors.As(err, &noEligible) {
		return fmt.Sprintf("↷ ID-JAG skipped — no eligible GenAI roles found for %s (projects: %s)",
			noEligible.UserPrincipal, noEligible.DomainTemplate)
	}
	return fmt.Sprintf("⚠ ID-JAG skipped — %v", err)
}
