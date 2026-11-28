/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

import { PartyRepository } from "../../../core/party/partyRepository.js";
import { Environment } from "../../../platform/environment.js";

export function createPlayerScreenMethods28() {
  const { PlayerController, t, clamp, escapeHtml } = internals;

  return {
    unbindVideoEvents() {
      this.videoListeners.forEach(({ target, eventName, handler }) => {
        target?.removeEventListener?.(eventName, handler);
      });
      this.videoListeners = [];
    },
    getPlaybackControlPaused() {
      const conversion = PlayerController.webOsDtsAudioState;
      // Native decoder pauses during a track reload are not user commands.
      if (conversion && (conversion.preparing || conversion.cancelReload || conversion.buffering)) {
        return conversion.controlPaused;
      }
      return this.paused;
    },
    getControlDefinitions() {
      const paused = this.getPlaybackControlPaused();
      const uiState = this.getPlayerUiState();
      const nextEpisode = this.resolveNextEpisodeInfo();
      const base = [
        {
          action: "playPause",
          label: paused ? ">" : "II",
          icon: paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg",
          title: paused ? t("cd_play", {}, "Play") : t("cd_pause", {}, "Pause"),
          primary: true
        }
      ];

      if (nextEpisode?.hasAired && !this.nextEpisodeLaunching) {
        base.push({
          action: "playNextEpisode",
          icon: "assets/icons/ic_player_skip_next.svg",
          useMask: true,
          title: t("next_episode_label", {}, "Next episode")
        });
      }

      if (Environment.isBrowser()) {
        const video = PlayerController?.video || null;
        const isMuted = Boolean(video?.muted) || Number(video?.volume ?? 1) === 0;
        base.push({
          action: "muteToggle",
          svg: isMuted
            ? '<svg class="player-control-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
            : '<svg class="player-control-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
          title: isMuted ? "Ativar som (M)" : "Silenciar (M)"
        });
      }

      if (this.hasSubtitleTracksAvailable())
        base.push({
          action: "subtitleDialog",
          icon: "assets/icons/ic_player_subtitles.svg",
          title: t("subtitle_dialog_title", {}, "Subtitles")
        });

      if (this.hasAudioTracksAvailable())
        base.push({
          action: "audioTrack",
          svg: '<svg class="player-control-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>',
          title: "Idioma do áudio (Dublagem)"
        });

      if (Array.isArray(this.playerChapters) && this.playerChapters.length > 1 && this.isLivePlayback?.() !== true) {
        base.push({
          action: "chapters",
          icon: "assets/icons/ic_player_chapters.svg",
          title: t("player_chapters", {}, "Chapters")
        });
      }

      base.push({
        action: "source",
        icon: "assets/icons/ic_player_source.svg",
        title: t("sources_title", {}, "Sources")
      });

      if (Array.isArray(uiState.episodesAll) && uiState.episodesAll.length) {
        base.push({
          action: "episodes",
          icon: "assets/icons/ic_player_episodes.svg",
          title: t("episodes_panel_title", {}, "Episodes")
        });
      }

      if (this.isPartyButtonAvailable?.()) {
        base.push({
          action: "party",
          icon: "assets/icons/ic_player_party.svg",
          useMask: true,
          title: t("party_title", {}, "Watch party"),
          className: PartyRepository.getState().party ? "is-party-active" : ""
        });
      }

      // Browser only (TV apps are always full screen): B27.
      if (Environment.isBrowser()) {
        base.push({
          action: "download",
          svg: '<svg class="player-control-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 20h14v-2H5v2zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h1z"/></svg>',
          title: t("player_download", {}, "Download")
        });
        base.push({
          action: "fullscreen",
          svg: '<svg class="player-control-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
          title: t("player_fullscreen", {}, "Tela cheia")
        });
      }

      base.push({
        action: "more",
        svg: this.moreActionsVisible
          ? '<svg class="player-control-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'
          : '<svg class="player-control-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
        title: t("player_more_actions_title", {}, "More Actions")
      });

      if (!this.moreActionsVisible) {
        return base;
      }

      const playbackSpeed = this.getPlaybackSpeed();
      const playbackSpeedOptions = this.getPlaybackSpeedOptions();
      return [
        ...base.slice(0, Math.max(0, base.length - 1)),
        ...(playbackSpeedOptions.length > 1
          ? [
              {
                action: "speed",
                label: `${playbackSpeed.toFixed(playbackSpeed % 1 ? 2 : 0)}x`,
                title: t("player_playback_speed", {}, "Playback speed")
              }
            ]
          : []),
        {
          action: "aspect",
          icon: "assets/icons/ic_player_aspect_ratio.svg",
          title: t("player_more_aspect_ratio", {}, "Aspect Ratio")
        },
        { action: "streamInfo", label: "ⓘ", title: t("cd_stream_info", {}, "Stream info") },
        { action: "backFromMore", label: "<", title: t("player_go_back", {}, "Back") }
      ];
    },
    getControlRenderSignature(controls = this.getControlDefinitions()) {
      return JSON.stringify(
        controls.map((control) => [
          control.action || "",
          control.label || "",
          control.icon || "",
          control.svg || "",
          control.title || "",
          Boolean(control.primary),
          Boolean(control.useMask),
          control.className || ""
        ])
      );
    },
    renderControlButtons() {
      if (this.isExternalFrameMode()) {
        return;
      }
      const wrap = this.uiRefs?.controlButtons;
      if (!wrap) {
        return;
      }

      if (this.isPostPlayVisible() || this.isPostPlayLoading()) {
        wrap.innerHTML = "";
        this.renderedControlSignature = "";
        this.syncPlayerOverlayLayoutState();
        return;
      }

      const controls = this.getControlDefinitions();
      const controlRenderSignature = this.getControlRenderSignature(controls);
      if (this.stickyProgressFocus && this.controlsVisible && !this.isDialogOpen() && this.isSeekBarAvailable()) {
        this.controlFocusZone = "progress";
      }
      this.controlFocusIndex = clamp(this.controlFocusIndex, 0, Math.max(0, controls.length - 1));

      const mountedButtons = Array.from(wrap.querySelectorAll(".player-control-btn"));
      const controlsMatchDom =
        mountedButtons.length === controls.length &&
        mountedButtons.every((button, index) => button.dataset.action === String(controls[index]?.action || ""));
      if (!controlsMatchDom || this.renderedControlSignature !== controlRenderSignature) {
        const video = PlayerController?.video || null;
        const volumePercent = video?.muted ? 0 : Math.round(clamp(Number(video?.volume ?? 1), 0, 1) * 100);
        wrap.innerHTML = controls
          .map((control) => {
            const inner = control.svg
              ? control.svg
              : control.icon
                ? control.primary || control.useMask
                  ? `<span class="player-control-icon player-control-icon-mask" style="-webkit-mask-image:url('${escapeHtml(control.icon)}');mask-image:url('${escapeHtml(control.icon)}');" aria-hidden="true"></span>`
                  : `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />`
                : `<span class="player-control-label">${escapeHtml(control.label || "")}</span>`;
            const buttonHtml = `
            <button class="player-control-btn focusable${control.primary ? " is-primary" : ""}${control.className ? ` ${escapeHtml(control.className)}` : ""}"
                    data-action="${control.action}"
                    title="${escapeHtml(control.title || "")}">
              ${inner}
            </button>
          `;
            if (control.action === "muteToggle") {
              return `
                <div class="player-volume-control">
                  ${buttonHtml}
                  <input type="range" class="player-volume-slider" min="0" max="100" value="${volumePercent}" aria-label="Volume" />
                </div>
              `;
            }
            return buttonHtml;
          })
          .join("");
        const slider = wrap.querySelector(".player-volume-slider");
        if (slider) {
          slider.addEventListener("input", (event) => {
            event.stopPropagation();
            const v = PlayerController?.video || null;
            if (!v) return;
            const nextPercent = clamp(Number(slider.value || 0), 0, 100);
            v.volume = nextPercent / 100;
            v.muted = nextPercent === 0;
            this.renderControlButtons();
          });
        }
      }
      this.renderedControlSignature = controlRenderSignature;

      const buttons = Array.from(wrap.querySelectorAll(".player-control-btn"));
      buttons.forEach((button, index) => {
        button.classList.toggle("focused", this.controlFocusZone === "buttons" && index === this.controlFocusIndex);
      });
      const progressShell = this.uiRefs?.progressShell;
      if (progressShell) {
        progressShell.classList.toggle("focused", this.controlFocusZone === "progress");
      }

      if (this.controlFocusZone === "progress") {
        buttons.forEach((button) => {
          if (typeof button.blur === "function") {
            button.blur();
          }
        });
        if (progressShell && document.activeElement !== progressShell && typeof progressShell.focus === "function") {
          progressShell.focus();
        }
      } else if (this.controlFocusZone === "buttons") {
        if (progressShell && document.activeElement === progressShell && typeof progressShell.blur === "function") {
          progressShell.blur();
        }
        const focusedButton = buttons[this.controlFocusIndex] || null;
        if (focusedButton && document.activeElement !== focusedButton && typeof focusedButton.focus === "function") {
          focusedButton.focus();
        }
      } else if (this.controlFocusZone === "skipIntro" || this.controlFocusZone === "nextEpisode") {
        buttons.forEach((button) => {
          if (typeof button.blur === "function") {
            button.blur();
          }
        });
        if (progressShell && document.activeElement === progressShell && typeof progressShell.blur === "function") {
          progressShell.blur();
        }
      }
      this.syncSkipIntroFocusState();
      this.renderNextEpisodeCard();
      this.syncNextEpisodeCardFocusState();
      this.syncPlayerOverlayLayoutState();
      this.renderBitmapSubtitleAtCurrentTime();
    },
    syncControlFocusDom() {
      if (this.isExternalFrameMode()) {
        return;
      }
      const wrap = this.uiRefs?.controlButtons;
      if (!wrap) {
        return;
      }

      const controls = this.getControlDefinitions();
      const buttons = Array.from(wrap.querySelectorAll(".player-control-btn"));
      const controlsMatchDom = buttons.every((button, index) => button.dataset.action === String(controls[index]?.action || ""));
      // This path is used only when focus moves. If playback state changed the
      // available controls without rendering them first, fall back to the full
      // state render instead of focusing a stale button.
      if (
        buttons.length !== controls.length ||
        !controlsMatchDom ||
        this.renderedControlSignature !== this.getControlRenderSignature(controls)
      ) {
        this.renderControlButtons();
        return;
      }

      this.controlFocusIndex = clamp(this.controlFocusIndex, 0, Math.max(0, controls.length - 1));
      buttons.forEach((button, index) => {
        button.classList.toggle("focused", this.controlFocusZone === "buttons" && index === this.controlFocusIndex);
      });

      const progressShell = this.uiRefs?.progressShell;
      progressShell?.classList.toggle("focused", this.controlFocusZone === "progress");

      if (this.controlFocusZone === "progress") {
        buttons.forEach((button) => button.blur?.());
        if (progressShell && document.activeElement !== progressShell) {
          progressShell.focus?.();
        }
      } else if (this.controlFocusZone === "buttons") {
        if (progressShell && document.activeElement === progressShell) {
          progressShell.blur?.();
        }
        const focusedButton = buttons[this.controlFocusIndex] || null;
        if (focusedButton && document.activeElement !== focusedButton) {
          focusedButton.focus?.();
        }
      } else if (this.controlFocusZone === "skipIntro" || this.controlFocusZone === "nextEpisode") {
        buttons.forEach((button) => button.blur?.());
        if (progressShell && document.activeElement === progressShell) {
          progressShell.blur?.();
        }
      }

      // Preserve the non-markup side effects of renderControlButtons().
      this.syncSkipIntroFocusState();
      this.renderNextEpisodeCard();
      this.syncNextEpisodeCardFocusState();
      this.syncPlayerOverlayLayoutState();
      this.renderBitmapSubtitleAtCurrentTime();
    },
    isDialogOpen() {
      return (
        this.subtitleDialogVisible ||
        this.subtitleTimingDialogVisible ||
        this.subtitleDelayOverlayVisible ||
        this.audioDialogVisible ||
        this.sourcesPanelVisible ||
        this.chaptersPanelVisible ||
        this.episodePanelVisible ||
        this.speedDialogVisible ||
        Boolean(this.partyPanelVisible)
      );
    },
    syncPlayerOverlayLayoutState() {
      const root = this.uiRefs?.root;
      if (!root) {
        return;
      }
      const postPlayState = this.getPostPlayState();
      const postPlayVisible = Boolean(postPlayState.isVisible);
      const postPlayTrailer = Boolean(postPlayState.isTrailerPlaying);
      const postPlayTrailerConsumed = Boolean(postPlayVisible && postPlayState.hasAutoPlayedTrailer);
      root.classList.toggle("controls-visible", Boolean(this.controlsVisible) && !this.isExternalFrameMode() && !postPlayVisible);
      root.classList.toggle("post-play-visible", postPlayVisible);
      root.classList.toggle("post-play-loading", Boolean(postPlayState.isLoadingRecommendation));
      root.classList.toggle("post-play-trailer", postPlayTrailer);
      root.classList.toggle("post-play-trailer-consumed", postPlayTrailerConsumed);
      root.classList.toggle("post-play-returning", Boolean(postPlayState.hasReturnedToPlayer));
      this.container?.classList.toggle("post-play-visible", postPlayVisible);
      this.container?.classList.toggle("post-play-trailer", postPlayTrailer);
      this.container?.classList.toggle("post-play-trailer-consumed", postPlayTrailerConsumed);
      this.container?.classList.toggle("post-play-returning", Boolean(postPlayState.hasReturnedToPlayer));
      this.syncPostPlayPlayerSurface(postPlayState);
      this.setPostPlaySubtitleOutputHidden(postPlayVisible);
      this.syncPlayerActionOverlayOffset();
    },
    cancelPostPlayPlayerSurfaceAnimation() {
      if (this.postPlayPlayerSurfaceAnimationFrame == null) {
        return;
      }
      if (this.postPlayPlayerSurfaceAnimationUsesRaf) {
        globalThis.cancelAnimationFrame?.(this.postPlayPlayerSurfaceAnimationFrame);
      } else {
        clearTimeout(this.postPlayPlayerSurfaceAnimationFrame);
      }
      this.postPlayPlayerSurfaceAnimationFrame = null;
    }
  };
}
