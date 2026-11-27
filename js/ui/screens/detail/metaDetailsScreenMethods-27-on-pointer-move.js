/* eslint-disable no-unused-vars */
import * as internals from "./metaDetailsScreenContext.js";

export function createMetaDetailsScreenMethods27() {
  const { ScreenUtils, buildYoutubeEmbedUrl } = internals;

  return {
    onPointerMove() {
      if (this.isTrailerPlaying && this.trailerPlaybackMode === "manual") {
        this.restartTrailerControlsTimer();
      }
    },
    onPointerFocus() {},
    onPointerSurfaceActivate(target, event) {
      if (!target || !this.container?.contains?.(target)) {
        return false;
      }
      if (!this.isTrailerPlaying || this.trailerPlaybackMode !== "manual") {
        return false;
      }
      if (!target.closest?.(".detail-trailer-layer")) {
        return false;
      }
      const seekTrack = target.closest?.("[data-trailer-seek-track]");
      if (seekTrack) {
        const trackNode = seekTrack.querySelector(".detail-trailer-progress-track") || seekTrack;
        const rect = trackNode.getBoundingClientRect?.();
        const playback = this.getTrailerPlaybackSnapshot();
        const duration = Number(playback?.duration || 0);
        if (rect && rect.width > 0 && duration > 0 && typeof event?.clientX === "number") {
          const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          this.seekTrailerToSeconds(duration * ratio);
          return true;
        }
        this.restartTrailerControlsTimer();
        return true;
      }
      this.toggleActiveTrailerPlayback();
      return true;
    },
    onPointerActivate(target) {
      if (!target || !this.container?.contains?.(target)) {
        return false;
      }
      const trailerAction = String(target?.closest?.("[data-trailer-action]")?.dataset?.trailerAction || "");
      if (trailerAction && this.isTrailerPlaying && this.trailerPlaybackMode === "manual") {
        if (trailerAction === "toggle") {
          this.toggleActiveTrailerPlayback();
          return true;
        }
        if (trailerAction === "seekBack") {
          this.restartTrailerControlsTimer();
          this.seekTrailerBy(-10);
          return true;
        }
        if (trailerAction === "seekForward") {
          this.restartTrailerControlsTimer();
          this.seekTrailerBy(10);
          return true;
        }
        if (trailerAction === "toggleMute") {
          this.toggleTrailerMute();
          return true;
        }
        if (trailerAction === "close") {
          this.consumeBackRequest();
          return true;
        }
      }
      const actionTarget = target?.closest?.("[data-action]");
      const action = String(actionTarget?.dataset?.action || "");
      if (action === "toggleTrailer") {
        this.playTrailer({ muted: false, restart: true, initiatedByUser: true });
        return true;
      }
      if (action === "openSharedTrailer") {
        const ytId = String(actionTarget.dataset.trailerYtId || "").trim();
        if (!ytId) {
          return false;
        }
        this.trailerSource = {
          kind: "youtube",
          ytId,
          embedUrl: buildYoutubeEmbedUrl(ytId, { muted: false })
        };
        this.playTrailer({
          muted: false,
          restart: true,
          initiatedByUser: true,
          preserveSource: true
        });
        return true;
      }
      if (action === "openTmdbEntity") {
        return this.openTmdbEntityFromNode(actionTarget);
      }
      if (!action) {
        return false;
      }

      // Pointer activation is a click, not a key-down/key-up hold. Reuse the
      // Android-aligned OK dispatcher so every detail action stays in one path.
      const activation = this.onKeyDown({
        keyCode: 13,
        pointerActivation: true,
        target: actionTarget,
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      });
      activation?.catch?.((error) => console.warn("Detail pointer activation failed", error));
      return true;
    },
    async onKeyUp(event) {
      if (Number(event?.keyCode || 0) !== 13) {
        return;
      }
      const current = this.container?.querySelector(".series-episode-card.focusable.focused") || null;
      if (await this.completePendingEpisodeHold(current, event)) {
        event?.preventDefault?.();
        return;
      }
      const season = this.container?.querySelector(".series-season-btn.focusable.focused") || null;
      if (this.completePendingSeasonHold(season, event)) {
        event?.preventDefault?.();
        return;
      }
      const poster = this.container?.querySelector(".detail-morelike-card.focusable.focused") || null;
      if (this.completePendingPosterHold(poster, event)) {
        event?.preventDefault?.();
        return;
      }
      const hero = this.container?.querySelector(".series-detail-actions .focusable.focused") || null;
      if (await this.completePendingHeroHold(hero, event)) {
        event?.preventDefault?.();
      }
    },
    cleanup() {
      this.synopsisDialog?.destroy();
      this.synopsisDialog = null;
      this.shuffleDialog?.destroy();
      this.shuffleDialog = null;
      this.commentOverlayDialog?.destroy();
      this.commentOverlayDialog = null;
      this.commentOverlay = null;
      this.activeRatingDialog?.close?.();
      this.activeRatingDialog = null;
      if (this.detailMessageTimer) {
        clearTimeout(this.detailMessageTimer);
        this.detailMessageTimer = null;
      }
      this.detailLoadToken = (this.detailLoadToken || 0) + 1;
      this.cancelTraktCommentsRequest();
      if (this.seasonSwitchTimer) {
        clearTimeout(this.seasonSwitchTimer);
        this.seasonSwitchTimer = null;
      }
      this.cancelPendingEpisodeHold();
      this.cancelPendingSeasonHold();
      this.cancelPendingPosterHold();
      this.cancelPendingHeroHold();
      this.posterOptionsController?.destroy?.({ restoreFocus: false });
      this.posterOptionsController = null;
      this.posterOptionsFocusRestore = null;
      this.destroyDetailHoldDialog();
      this.episodeHoldMenu = null;
      this.seasonHoldMenu = null;
      this.heroPlayMenu = null;
      this.libraryListMenu = null;
      if (this.episodeVirtualSyncRaf) {
        cancelAnimationFrame(this.episodeVirtualSyncRaf);
        this.episodeVirtualSyncRaf = null;
      }
      if (this._sectionsUpdateRaf) {
        const cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
        cancelRaf(this._sectionsUpdateRaf);
        this._sectionsUpdateRaf = null;
      }
      this.episodeThumbnailPrefetchCache = new Set();
      if (this.episodeThumbObserver) {
        try {
          this.episodeThumbObserver.disconnect();
        } catch (_) {}
        this.episodeThumbObserver = null;
      }
      this.clearEpisodeTitleMarquee(this.episodeMarqueeTitle);
      this.selectedSeasonEpisodeState = null;
      if (this.episodeTrackScrollNode && this.episodeTrackScrollHandler) {
        this.episodeTrackScrollNode.removeEventListener("scroll", this.episodeTrackScrollHandler);
      }
      this.episodeTrackScrollNode = null;
      this.episodeTrackScrollHandler = null;
      this.episodeVirtualWindow = null;
      this.episodeVirtualMetrics = null;
      this.stopTrailerPlayback({
        keepDom: false,
        restartAutoplay: false,
        restoreFocus: false,
        immediateClear: true
      });
      if (this.detailScrollHandler && this.container) {
        const content = this.container.querySelector(".series-detail-content");
        if (content) {
          content.removeEventListener("scroll", this.detailScrollHandler);
        }
        this.detailScrollHandler = null;
      }
      if (this.detailFocusHandler && this.container) {
        this.container.removeEventListener("focusin", this.detailFocusHandler, true);
        this.detailFocusHandler = null;
      }
      if (this.detailClickHandler && this.container) {
        this.container.removeEventListener("click", this.detailClickHandler, true);
        this.detailClickHandler = null;
      }
      if (this.trailerProxyMessageHandler) {
        window.removeEventListener("message", this.trailerProxyMessageHandler);
        this.trailerProxyMessageHandler = null;
      }
      ScreenUtils.hide(this.container);
    }
  };
}
