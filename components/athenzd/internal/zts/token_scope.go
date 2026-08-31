package zts

import (
	"fmt"
	"sort"
	"strings"
)

// These helpers validate scopes on both ID-JAG and access-token responses.
// They intentionally belong to neither credential-specific transport.
func tokenScopes(claims map[string]any) ([]string, error) {
	for _, name := range []string{"scp", "scope"} {
		value, ok := claims[name]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			scopes := uniqueScopes(typed)
			if len(scopes) > 0 {
				return scopes, nil
			}
		case []any:
			values := make([]string, 0, len(typed))
			for _, item := range typed {
				text, ok := item.(string)
				if !ok || strings.TrimSpace(text) == "" {
					return nil, fmt.Errorf("issued token contained a non-string %s scope", name)
				}
				values = append(values, text)
			}
			scopes := uniqueScopes(strings.Join(values, " "))
			if len(scopes) > 0 {
				return scopes, nil
			}
		default:
			return nil, fmt.Errorf("issued token contained an invalid %s claim", name)
		}
	}
	return nil, fmt.Errorf("issued token did not contain scp or scope claims")
}

func uniqueScopes(scope string) []string {
	set := map[string]struct{}{}
	for _, value := range strings.Fields(scope) {
		set[value] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func containsAllScopes(granted, requested []string) bool {
	set := make(map[string]struct{}, len(granted))
	for _, scope := range granted {
		set[scope] = struct{}{}
	}
	for _, scope := range requested {
		if _, ok := set[scope]; !ok {
			return false
		}
	}
	return true
}
