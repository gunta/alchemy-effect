import * as Core from "alchemy/Convex";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertNotAny<T> = IsAny<T> extends true ? never : T;

const convexCli: AssertNotAny<typeof Core.ConvexCli> = Core.ConvexCli;
const providerEffect: AssertNotAny<typeof Provider.effect> = Provider.effect;
const providerSucceed: AssertNotAny<typeof Provider.succeed> = Provider.succeed;
const resource: AssertNotAny<typeof Resource> = Resource;

void convexCli;
void providerEffect;
void providerSucceed;
void resource;
