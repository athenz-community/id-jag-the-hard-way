"use client"

import { Plus, Trash2 } from "lucide-react"

export type ContainerArgumentDraft = {
  id: number
  value: string
}

export function ContainerArgumentsField({
  idPrefix,
  containerArguments,
  onChange,
}: {
  idPrefix: string
  containerArguments: ContainerArgumentDraft[]
  onChange: (containerArguments: ContainerArgumentDraft[]) => void
}) {
  function updateArgument(id: number, value: string) {
    onChange(containerArguments.map((argument) => argument.id === id ? { ...argument, value } : argument))
  }

  function addArgument() {
    if (containerArguments.length >= 50) return
    onChange([
      ...containerArguments,
      { id: Math.max(0, ...containerArguments.map(({ id }) => id)) + 1, value: "" },
    ])
  }

  function deleteArgument(id: number) {
    onChange(containerArguments.filter((argument) => argument.id !== id))
  }

  return (
    <div className="mcp-create-field">
      <label htmlFor={`${idPrefix}-argument-1`}>Container arguments</label>
      <p>Add each Kubernetes container argument separately and in order.</p>
      <div className="mcp-create-argument-list">
        {containerArguments.map((argument, index) => (
          <div className="mcp-create-argument-row" key={argument.id}>
            <input
              id={`${idPrefix}-argument-${argument.id}`}
              className="filter-select"
              name="arguments"
              aria-label={`Container argument ${index + 1}`}
              placeholder={index === 0 ? "e.g. --transport" : "e.g. streamable-http"}
              maxLength={4096}
              value={argument.value}
              onChange={(event) => updateArgument(argument.id, event.target.value)}
            />
            <button
              className="table-action"
              type="button"
              aria-label={`Delete container argument ${index + 1}`}
              disabled={containerArguments.length === 1}
              onClick={() => deleteArgument(argument.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <button className="button" type="button" disabled={containerArguments.length >= 50} onClick={addArgument}>
        <Plus size={14} />
        Add container argument
      </button>
    </div>
  )
}
