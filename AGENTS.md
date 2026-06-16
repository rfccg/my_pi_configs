# Pi local agent policy

- Treat Gondolin as the required filesystem boundary for agent/tool file access.
- New extensions or tools that read, list, search, write, edit, or spawn commands against project files must route those operations through the Gondolin VM or an equivalent sandboxed filesystem provider.
- Do not add extensions that read project files directly with host `fs` APIs and then expose that content to the model.
- Subagents must inherit the same extension/sandbox routing; do not launch subagent Pi processes with extensions disabled unless another sandbox is explicitly applied.
- `.pi-ignore` is enforced by the local Gondolin extension as a VM filesystem filter. Do not bypass it with host-side file reads.
