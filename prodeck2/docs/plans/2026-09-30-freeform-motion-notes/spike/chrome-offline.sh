#!/bin/sh
# Chrome with no route off this machine: every connection but one to this machine itself goes to a proxy that is not there.
exec '/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r044/profile/hyperframes/2026-09-24/chrome-headless-shell/mac_arm-152.0.7977.30/chrome-headless-shell-mac-arm64/chrome-headless-shell' "$@" --proxy-server=http://127.0.0.1:9 '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]' --force-webrtc-ip-handling-policy=disable_non_proxied_udp --block-new-web-contents
