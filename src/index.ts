type Progress = {
  controller: string;
  type: string;
  score: number;
  level: number;
  state: any;
  continueScore: number;
};

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
    "http://localhost:63342",
    "http://localhost:8080",
    "http://localhost:3000",
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

      // Set the canvas fullwidth
      const canvas: HTMLCollection = document.getElementsByTagName("canvas");
      
      setTimeout(
        () => {
          let canvasStyle = canvas[0].getAttribute("style");
          canvas[0].setAttribute(
            "style",
            canvasStyle + "width: 100%; margin: 0; padding: 0;"
          );
        },
        2000
      );
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
        self.debug(
          "Event Received -> %o -> %o",
          event.data,
          event.origin
        );

        if (
          typeof event.data == "object" &&
          event.data.controller &&
          event.data.controller == "_digitapApp"
        ) {
          let originIndex = self.allowedOrigins.indexOf(event.origin);

          if (originIndex === -1) {
            self.debug("Error: Origin not allowed inside game container!");
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

                self.afterContinueWithCurrentScore(self.progress.score);
                break;

              default:
                self.debug(
                  'Error: `data.type` = "' +
                    event.data.type +
                    '" not found! Please check `readme.md` of data collector package!'
                );
                break;
            }
          } else {
            self.debug("Error: `event.data.type` should be implemented!");
          }
        }
      },
      false
    );
  }

  /**
   * Empty methods for game developer to use.
   */
  public static afterStartGameFromZero() {}

  public static afterContinueWithCurrentScore(score: number) {}

  public static afterStartGame() {}

  public static afterPauseGame() {}

  /**
   * If user is debugging, show some console logs.
   *
   * @param message any
   * @param params any[]
   */
  private static debug(message?: any, ...params: any[]): void {
    if (!this.isDebugging) {
      console.log("DigitapGamePlayerSDK -> " + message, ...params);
    }
  }

  /**
   * Helper method to set SDK as debugging.
   */
  public static setDebugging(): void {
    this.isDebugging = true;
  }
}

// Read the current queue
if (typeof (<any>window).digitapSDK !== "undefined") {
  let oldQueue = (<any>window).digitapSDK.q;
  DigitapGamePlayerSDK.processOldQueue(oldQueue);
}

// Watch the queue with new method
(<any>window).digitapSDK = DigitapGamePlayerSDK.processQueue;
