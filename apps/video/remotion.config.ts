import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// 60fps vertical is the platform-native format; anything less reads as an ad.
Config.setConcurrency(2);
Config.setChromiumOpenGlRenderer("angle");
