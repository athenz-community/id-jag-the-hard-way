package config

import (
	"fmt"
	"os"

	"go.yaml.in/yaml/v3"
)

var (
	marshalYAML     = yaml.Marshal
	statConfigFile  = os.Stat
	writeConfigFile = os.WriteFile
)

// SaveDefaultProject adds or replaces gen_ai.default_project in the
// selected config file. A YAML node update keeps the setting beside the other
// GenAI settings and preserves comments carried by the parsed document.
func SaveDefaultProject(path, project string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("reading config to save default GenAI project: %w", err)
	}
	var document yaml.Node
	if err := yaml.Unmarshal(data, &document); err != nil {
		return fmt.Errorf("parsing config to save default GenAI project: %w", err)
	}
	if len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return fmt.Errorf("config root must be a YAML mapping")
	}

	root := document.Content[0]
	genAI := mappingValue(root, "gen_ai")
	if genAI == nil || genAI.Kind != yaml.MappingNode {
		return fmt.Errorf("config gen_ai must be a YAML mapping")
	}
	setMappingValue(genAI, "default_project", project)
	removeMappingValue(genAI, "default_domain_role")

	updated, err := marshalYAML(&document)
	if err != nil {
		return fmt.Errorf("encoding config with default GenAI project: %w", err)
	}
	info, err := statConfigFile(path)
	if err != nil {
		return fmt.Errorf("reading config permissions: %w", err)
	}
	if err := writeConfigFile(path, updated, info.Mode().Perm()); err != nil {
		return fmt.Errorf("saving default GenAI project: %w", err)
	}
	return nil
}

func removeMappingValue(mapping *yaml.Node, key string) {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			mapping.Content = append(mapping.Content[:i], mapping.Content[i+2:]...)
			return
		}
	}
}

func mappingValue(mapping *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i+1]
		}
	}
	return nil
}

func setMappingValue(mapping *yaml.Node, key, value string) {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			mapping.Content[i+1].Kind = yaml.ScalarNode
			mapping.Content[i+1].Tag = "!!str"
			mapping.Content[i+1].Value = value
			return
		}
	}
	mapping.Content = append(mapping.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value})
}
