import { Router, type IRouter } from "express";
import healthRouter from "./health";
import classosRouter from "./classos";
import accountsRouter from "./accounts";
import handoversRouter from "./handovers";
import studentLearningRouter from "./student-learning";
import filesRouter from "./files";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountsRouter);
router.use(handoversRouter);
router.use("/student", studentLearningRouter);
router.use(filesRouter);
router.use(classosRouter);

export default router;
