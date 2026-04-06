import { Router, type IRouter } from "express";
import healthRouter from "./health";
import benchmarksRouter from "./benchmarks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(benchmarksRouter);

export default router;
