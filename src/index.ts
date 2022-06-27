type Progress = {
  controller: string;
  type: string;
  score: number;
  level: number;
  state: any;
  continueScore: number;
};

interface CanvasElement extends HTMLCanvasElement {
  captureStream(frameRate?: number): MediaStream;
}

class DigitapGamePlayerSDK {
  public static gameObject: any = null;
  private static isLoaded: boolean = false;
  private static origin: string = null;
  private static isDebugging: boolean = false;

  private static allowedOrigins: string[] = [
    "https://build.digitap.dev",
    "https://wam.app",
    "https://app.wam.app",
    "https://wam.eu",
    "https://play.wam.app",
    "https://stage.wam.app",
    "http://localhost:63342",
    "http://localhost:8080",
    "http://localhost:3000",
    "http://localhost:3001",
    "https://localhost:3001",
    "http://127.0.0.1:3001",
    "https://127.0.0.1:3001",
  ];

  private static progress: Progress = {
    controller: "_digitapGame",
    type: "SDK_PLAYER_SCORE_UPDATE",
    score: 0,
    level: 0,
    state: null,
    continueScore: 0,
  };

  /**
   * Call a method from the class,
   * through a queue.
   *
   * @param args array
   */
  public static processQueue(...args: any[]): void {
    DigitapGamePlayerSDK.debug("Processing Queue ->", args);

    if (typeof args[0] === "string") {
      DigitapGamePlayerSDK[
        args[0] as
          | "init"
          | "setProgress"
          | "setLevelUp"
          | "setPlayerFailed"
          | "setCallback"
      ].apply(DigitapGamePlayerSDK, args.slice(1));
    }
  }

  /**
   * Process a current queue.
   *
   * @param queue array
   */
  public static processOldQueue(queue: []): void {
    queue.forEach((args: any) => {
      this.processQueue(...args);
    });
  }

  /**
   * Sets a callback method.
   *
   * @param fn string
   * @param callback function
   */
  public static setCallback(
    fn:
      | "afterStartGameFromZero"
      | "afterContinueWithCurrentScore"
      | "afterStartGame"
      | "afterPauseGame",
    callback: any
  ): void {
    this[fn] = callback;
  }

  /**
   * Init a new game connection with
   * the parent platform.
   *
   * @param uiOptions array
   */
  public static init(
    hasScore: boolean = true,
    hasHighScore: boolean = true
  ): void {
    this.debug("SDK Initialization");

    // Init the uiOptions
    const uiOptions = ["score", "highScore", hasScore, hasHighScore];

    // If SDK is not loaded yet
    if (!this.isLoaded) {
      // Send the init message
      window.parent.postMessage(
        {
          controller: "_digitapGame",
          type: "SDK_SETTINGS",
          ui: uiOptions,
          ready: true,
        },
        "*"
      );

      // Watch for messages from GameBox
      this.listenGameboxEvents();

      // Watch for messages from Streamr
      this.listenStreamrEvents();

      // Set the canvas fullwidth & blue screen fix
      const canvas: HTMLCollection = document.getElementsByTagName("canvas");
      const html: HTMLCollection = document.getElementsByTagName("html");

      setTimeout(() => {
        let canvasStyle = canvas[0].getAttribute("style");
        canvas[0].setAttribute(
          "style",
          canvasStyle +
            "width: 100%; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; -moz-user-select: none;"
        );

        let htmlStyle = html[0].getAttribute("style");
        html[0].setAttribute(
          "style",
          (htmlStyle ? htmlStyle : "") +
            "user-select: none; -webkit-user-select: none; -moz-user-select: none;"
        );
      }, 2000);
    }

    // Set SDK as loaded to prevent re-initiation
    this.isLoaded = true;
  }

  /**
   * Set progress of a game.
   *
   * @param type string
   * @param state string
   * @param score number
   * @param level number
   */
  public static setProgress(state: string, score: number, level: number): void {
    // Set the current progress
    this.progress = {
      type: "SDK_PLAYER_SCORE_UPDATE",
      state,
      score,
      level,
      continueScore: score,
      controller: "_digitapGame",
    };

    this.sendData();
  }

  /**
   * Set the new level of the game.
   *
   * @param level number
   */
  public static setLevelUp(level: number): void {
    this.progress.level = level;
    this.progress.type = "SDK_PLAYER_LEVEL_UP";

    this.sendData();
  }

  /**
   * Set the game as failed.
   *
   * @param state string
   */
  public static setPlayerFailed(state: string = "FAIL"): void {
    this.progress.state = state;
    this.progress.score = 0;
    this.progress.type = "SDK_PLAYER_FAILED";

    this.sendData();
  }

  /**
   * Sends game data to parent platform.
   */
  private static sendData(): void {
    // Send the message to Gamebox.
    window.parent.postMessage(this.progress, this.origin);
  }

  /**
   * Start listening for messages
   * from the platform.
   */
  private static listenGameboxEvents(): void {
    const self = this;

    window.addEventListener(
      "message",
      function (event) {
        DigitapGamePlayerSDK.debug("Event Received -> %o -> %o", event.data, event.origin);

        if (
          typeof event.data == "object" &&
          event.data.controller &&
          event.data.controller == "_digitapApp"
        ) {
          let originIndex = self.allowedOrigins.indexOf(event.origin);

          if (originIndex === -1) {
            DigitapGamePlayerSDK.debug("Error: Origin not allowed inside game container!");
            return;
          } else {
            self.origin = self.allowedOrigins[originIndex];
          }

          if (event.data.type) {
            switch (event.data.type) {
              case "SDK_START_GAME":
                self.afterStartGame();
                break;

              case "SDK_PAUSE_GAME":
                self.afterPauseGame();
                break;

              case "SDK_START_GAME_FROM_ZERO":
                self.progress.score = 0;
                self.progress.level = 0;
                self.progress.continueScore = 0;

                self.afterStartGameFromZero();
                break;

              case "SDK_CONTINUE_WITH_CURRENT_SCORE":
                self.progress.score = self.progress.continueScore;

                self.afterContinueWithCurrentScore(
                  self.progress.score,
                  self.progress.level
                );
                break;

              default:
                DigitapGamePlayerSDK.debug(
                  'Error: `data.type` = "' +
                    event.data.type +
                    '" not found! Please check `readme.md` of data collector package!'
                );
                break;
            }
          } else {
            DigitapGamePlayerSDK.debug("Error: `event.data.type` should be implemented!");
          }
        }
      },
      false
    );
  }

  /**
   * Start listening for messages
   * from the Streamr platform.
   */
  private static listenStreamrEvents(): void {
    let canvas: CanvasElement = null;
    let stream: any = null;
    let connection: any = null;
    let channel: any = null;
    let iceCandidate: any = null;
    let connected = false;
    let isNegotiationNeeded = false;

    let self = this;
    self.debug("Init Streamr v1.0.8");

    window.addEventListener("message", async (event) => {
      try {
        DigitapGamePlayerSDK.debug("Streamr Event received", event.data);

        if (!event.data || typeof event.data !== "object") {
          return;
        }

        const { controller, type, action, offer, tournament_id, username } =
          event.data;

        DigitapGamePlayerSDK.debug(
          "Streamr Event details: ",
          controller,
          type,
          action,
          offer,
          tournament_id,
          username
        );

        if (controller !== "_digitapApp" && type !== "webrtc") {
          return;
        }

        // if (!connected) {
        //   canvas = <CanvasElement>document.querySelector("canvas");
        //   stream = canvas.captureStream(30);
        //   connection = new RTCPeerConnection({
        //     iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        //   });
        //   channel = connection.createDataChannel(
        //     `streamr-${tournament_id}-${username}`,
        //     {
        //       negotiated: true,
        //       id: 0,
        //     }
        //   );
        // }

        // if (action === "close") {
        //   for (let sender of connection.getSenders()) {
        //     connection.removeTrack(sender);
        //   }

        //   canvas = null;
        //   stream = null;

        //   channel.send(JSON.stringify({ type: "streamr", action: "close" }));
        //   connection.close();

        //   connection = null;
        //   channel = null;
        //   iceCandidate = null;
        //   connected = false;
        //   isNegotiationNeeded = false;
        //   return;
        // }

        // if (action === "init") {
        //   for (const track of stream.getTracks()) {
        //     connection.addTrack(track, stream);
        //   }

        //   const onConnectionStateChange = (e: any) => {
        //     self.debug(
        //       "__WEBRTC.onConnectionStateChange__",
        //       connection.connectionState
        //     );
        //     switch (connection.connectionState) {
        //       case "connected":
        //         connected = true;

        //         (<Window>event.source).postMessage(
        //           { type: "streamr", action: "connected" },
        //           event.origin
        //         );
        //         break;
        //       case "disconnected":
        //         for (let sender of connection.getSenders()) {
        //           connection.removeTrack(sender);
        //         }
        //         canvas = null;
        //         stream = null;

        //         (<Window>event.source).postMessage(
        //           { type: "streamr", action: "disconnected" },
        //           event.origin
        //         );

        //         channel.close();
        //         connection.close();
        //         connection.removeEventListener(
        //           "connectionstatechange",
        //           onConnectionStateChange
        //         );
        //         connection.removeEventListener(
        //           "iceconnectionstatechange",
        //           onIceConnectionStateChange
        //         );
        //         connection.removeEventListener("icecandidate", onIceCandidate);
        //         connection.removeEventListener(
        //           "onnegotiationneeded",
        //           onNegotiationNeeded
        //         );
        //         connection.removeEventListener(
        //           "onsignalingstatechange",
        //           onSignalingStateChange
        //         );
        //         channel.removeEventListener("message", onMessage);

        //         connection = null;
        //         channel = null;
        //         iceCandidate = null;
        //         connected = false;

        //         break;
        //     }
        //   };

        //   const onIceConnectionStateChange = (event: any) => {
        //     self.debug(
        //       "__WEBRTC.onICEConnectionStateChange__",
        //       connection.iceConnectionState
        //     );
        //     switch (connection.iceConnectionState) {
        //       case "connected":
        //         break;
        //       case "disconnected":
        //       case "failed":
        //         connection.restartIce();
        //         break;
        //     }
        //   };

        //   const onIceCandidate = (e: any) => {
        //     try {
        //       self.debug("__WEBRTC.onICECandidate__", e.candidate);

        //       if (e.candidate) {
        //         iceCandidate = e.candidate;
        //       } else {
        //         self.debug(
        //           "__WEBRTC.localDescription__",
        //           connection.localDescription
        //         );

        //         (<Window>event.source).postMessage(
        //           {
        //             type: "streamr",
        //             action: "answer",
        //             offer: window.btoa(
        //               JSON.stringify(connection.localDescription)
        //             ),
        //           },
        //           event.origin
        //         );
        //       }
        //     } catch (err) {
        //       console.error("__WEBRTC.onICECandidate__", err.message);
        //     }
        //   };

        //   const onMessage = async (event: any) => {
        //     try {
        //       if (!event.data) {
        //         return;
        //       }

        //       const message = JSON.parse(event.data);

        //       if (message.iceCandidate) {
        //         await connection.addIceCandidate(message.iceCandidate);
        //         channel.send(JSON.stringify({ iceCandidate }));
        //       }
        //     } catch (err) {
        //       console.error("__WEBRTC.onMessage__", err.message);
        //     }
        //   };

        //   const onNegotiationNeeded = async (event: any) => {
        //     try {
        //       if (isNegotiationNeeded) {
        //         return;
        //       }

        //       await connection.setRemoteDescription(JSON.parse(offer));
        //       await connection.setLocalDescription(
        //         await connection.createAnswer()
        //       );
        //     } catch (err) {
        //       console.error("__WEBRTC.onNegotiationNeeded", err.message);
        //     }
        //   };

        //   const onSignalingStateChange = (e: any) =>
        //     (isNegotiationNeeded = connection.signalingState !== "stable");

        //   connection.addEventListener(
        //     "connectionstatechange",
        //     onConnectionStateChange
        //   );
        //   connection.addEventListener(
        //     "iceconnectionstatechange",
        //     onIceConnectionStateChange
        //   );
        //   connection.addEventListener("icecandidate", onIceCandidate);
        //   connection.addEventListener(
        //     "onnegotiationneeded",
        //     onNegotiationNeeded
        //   );
        //   connection.addEventListener(
        //     "onsignalingstatechange",
        //     onSignalingStateChange
        //   );
        //   channel.addEventListener("message", onMessage);

        //   await connection.setRemoteDescription(JSON.parse(offer));
        //   await connection.setLocalDescription(await connection.createAnswer());
        // }
      } catch (err) {
        self.debug("__WEBRTC__", err.message);
      }
    });
  }

  /**
   * Empty methods for game developer to use.
   */
  public static afterStartGameFromZero() {}

  public static afterContinueWithCurrentScore(score: number, level: number) {}

  public static afterStartGame() {}

  public static afterPauseGame() {}

  /**
   * If user is debugging, show some console logs.
   *
   * @param message any
   * @param params any[]
   */
  private static debug(message?: any, ...params: any[]): void {
    const parentWindow: any = window;

    // if (parentWindow.sdkdebug) {
      console.log("DigitapGamePlayerSDK -> " + message, ...params);
    // }
  }
}

// Read the current queue
if (typeof (<any>window).digitapSDK !== "undefined") {
  let oldQueue = (<any>window).digitapSDK.q;
  DigitapGamePlayerSDK.processOldQueue(oldQueue);
}

// Watch the queue with new method
(<any>window).digitapSDK = DigitapGamePlayerSDK.processQueue;

// Force the logs to be hidden
const log = window.console.log;
window.console.log = function (...args: any) {
  return true;
};
