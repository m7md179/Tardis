# Ollama GPU Setup — Proxmox LXC (CT 106)

Guide for passing through the GTX 1650 Super to the TARDIS LXC container and running Ollama with Qwen3 1.7B.

---

## 1. Install NVIDIA Drivers on the Proxmox Host

SSH into the Proxmox host (not the container):

```bash
# Install kernel headers and NVIDIA driver
apt update
apt install -y pve-headers-$(uname -r) nvidia-driver

# Load the NVIDIA kernel modules
nvidia-modprobe

# Verify the GPU is detected
nvidia-smi
```

You should see the GTX 1650 Super listed. Note the **driver version** (e.g. `550.xx`) — the container must match exactly.

---

## 2. Add GPU Device Mounts to the Container

Edit the container config on the Proxmox host:

```bash
nano /etc/pve/lxc/106.conf
```

Add these lines at the bottom:

```
# GPU passthrough
lxc.cgroup2.devices.allow: c 195:* rwm
lxc.cgroup2.devices.allow: c 509:* rwm
lxc.mount.entry: /dev/nvidia0 dev/nvidia0 none bind,optional,create=file
lxc.mount.entry: /dev/nvidiactl dev/nvidiactl none bind,optional,create=file
lxc.mount.entry: /dev/nvidia-uvm dev/nvidia-uvm none bind,optional,create=file
lxc.mount.entry: /dev/nvidia-uvm-tools dev/nvidia-uvm-tools none bind,optional,create=file
```

> **Note:** The cgroup numbers `195` and `509` are standard for NVIDIA devices. You can verify with `ls -la /dev/nvidia*` on the host to check the major numbers.

Restart the container:

```bash
pct stop 106
pct start 106
```

---

## 3. Install NVIDIA Drivers Inside the Container

Enter the container:

```bash
pct enter 106
```

Install the **same driver version** as the host. There are two ways:

### Option A: Package manager (easier)

```bash
apt update
apt install -y nvidia-utils-550  # Replace 550 with your host driver version
```

### Option B: NVIDIA .run installer (if package isn't available)

```bash
# Download the matching driver from NVIDIA's site
wget https://us.download.nvidia.com/XFree86/Linux-x86_64/550.XX/NVIDIA-Linux-x86_64-550.XX.run

# Install userspace only (no kernel module — the host handles that)
chmod +x NVIDIA-Linux-x86_64-550.XX.run
./NVIDIA-Linux-x86_64-550.XX.run --no-kernel-module
```

Verify GPU access inside the container:

```bash
nvidia-smi
```

You should see the GTX 1650 Super with 4GB VRAM.

> **Critical:** The driver version inside the container **MUST** match the host exactly. Mismatched versions will cause `nvidia-smi` to fail with "driver/library mismatch" errors.

---

## 4. Install Ollama

Inside the container:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Ollama installs as a systemd service and starts automatically.

Pull the base model and create the custom TARDIS model:

```bash
ollama pull qwen3:1.7b

# Create the custom model with optimized parameters
# The Modelfile is deployed with the plugin
ollama create tardis-assistant -f /var/lib/tardis/plugins/tardis-assistant/Modelfile
```

Verify it's using the GPU:

```bash
# In one terminal, run the model
ollama run tardis-assistant "hello"

# In another terminal, check GPU memory usage
nvidia-smi
```

You should see Ollama using ~1.5GB of the 4GB VRAM.

---

## 5. Configure Ollama for TARDIS

If TARDIS runs in the **same container** (CT 106), no extra config is needed — it connects to `localhost:11434` by default.

If TARDIS runs in a **different container**, make Ollama listen on all interfaces:

```bash
# Create systemd override
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
EOF

# Reload and restart
systemctl daemon-reload
systemctl restart ollama
```

Then set the Ollama URL in TARDIS:

```
plugin gemini-assistant config ollamaUrl http://<container-ip>:11434
```

---

## 6. Verify Everything Works

```bash
# Test the OpenAI-compatible endpoint (what TARDIS uses)
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:1.7b",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "stream": false
  }'
```

You should get a JSON response with `choices[0].message.content`.

Then deploy TARDIS and test from Telegram:

```bash
# On your dev machine
./scripts/deploy.sh
```

Test messages:

- "what's on my list?" — should call `list_tasks`
- "start working on standup" — should chain `get_status` → `stop_tracking` → `start_tracking`
- "add a meeting tomorrow at 2pm" — should call `add_task`

---

## Troubleshooting

| Problem                                      | Fix                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `nvidia-smi` fails in container              | Driver version mismatch — reinstall matching version                                                    |
| `nvidia-smi: command not found`              | Install `nvidia-utils-XXX` in the container                                                             |
| `/dev/nvidia0: no such file`                 | Run `nvidia-modprobe` on the host, then restart container                                               |
| Ollama ignores GPU                           | Check `CUDA_VISIBLE_DEVICES` isn't set; verify `nvidia-smi` works first                                 |
| Ollama not reachable from other containers   | Set `OLLAMA_HOST=0.0.0.0` (see step 5)                                                                  |
| Container won't start after adding GPU lines | Check `/dev/nvidia*` devices exist on host; remove `nvidia-uvm-tools` line if that device doesn't exist |
