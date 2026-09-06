"use client"

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
  function updateArguments(value: string) {
    onChange(value.split("\n").map((argument, index) => ({ id: index + 1, value: argument })))
  }

  return (
    <div className="mcp-create-field">
      <label htmlFor={`${idPrefix}-arguments`}>Container arguments</label>
      <p>Enter one Kubernetes container argument per line, in order. Blank lines and indentation are ignored. Up to 50 arguments are supported.</p>
      <textarea
        id={`${idPrefix}-arguments`}
        className="filter-select mcp-create-arguments-textarea"
        name="arguments"
        rows={7}
        placeholder={"--transport\nstreamable-http\n--host\n0.0.0.0\n--port\n9000"}
        value={containerArguments.map(({ value }) => value).join("\n")}
        onChange={(event) => updateArguments(event.target.value)}
      />
    </div>
  )
}
